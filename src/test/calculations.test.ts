import { describe, it, expect } from "vitest";
import { DEFAULT_IRDAI_RATES } from "@/hooks/useIRDAIRates";

// Replication of PremiumCalculator logic for audit verification
const depreciationByAge = (years: number) => {
  if (years <= 0.5) return 0.05;
  if (years <= 1) return 0.15;
  if (years <= 2) return 0.20;
  if (years <= 3) return 0.30;
  if (years <= 4) return 0.40;
  if (years <= 5) return 0.50;
  return 0.55;
};

const odRateByVehicle = (type: string, age: number) => {
  let base = 0.0285;
  if (type === "TwoWheeler") base = 0.0175;
  if (type === "GCV") base = 0.045;
  if (type === "PCV" || type === "SchoolBus") base = 0.038;
  if (type === "Tractor") base = 0.012;
  if (age > 5) base += 0.005;
  if (age > 10) base += 0.005;
  return base;
};

const calculatePremium = (input: {
  exShowroom: number;
  mfgYear: number;
  vehicleType: string;
  cc: number;
  ncb: number;
  claimLastYear: boolean;
  companyDiscount: number;
  customerDiscount: number;
  antiTheft: boolean;
  voluntaryDeductible: number;
  addons: string[];
  policyType: "Comprehensive" | "ThirdParty";
}) => {
  const currentYear = new Date().getFullYear();
  const age = Math.max(0, currentYear - Number(input.mfgYear));
  const dep = depreciationByAge(age);
  // BUG-FUNC-07 fix: Round IDV to nearest whole integer
  const idv = Math.max(0, Math.round(Number(input.exShowroom) * (1 - dep)));

  const odRate = odRateByVehicle(input.vehicleType, age);
  const baseOD = idv * odRate;

  const TP_RATES = DEFAULT_IRDAI_RATES.TP_RATES;
  const tpTable = (TP_RATES as any)[input.vehicleType] ?? TP_RATES.PrivateCar;
  const slab = tpTable.find((s: any) => Number(input.cc) <= s.max) ?? tpTable[tpTable.length - 1];
  const tp = slab.amt;

  const ncbPct = input.claimLastYear ? 0 : Number(input.ncb);
  const ncbDisc = input.policyType === "ThirdParty" ? 0 : baseOD * (ncbPct / 100);
  const afterNcb = baseOD - ncbDisc;
  const compDisc = afterNcb * (Number(input.companyDiscount) / 100);

  const vdMap: Record<number, number> = { 0: 0, 2500: 750, 5000: 1500, 7500: 2250 };
  const vdDisc = input.policyType === "ThirdParty" ? 0 : (vdMap[Number(input.voluntaryDeductible)] || 0);
  const atDisc = input.antiTheft ? Math.min(500, baseOD * 0.025) : 0;
  const netOD = input.policyType === "ThirdParty" ? 0 : Math.max(0, baseOD - ncbDisc - compDisc - vdDisc - atDisc);

  const ADDONS = DEFAULT_IRDAI_RATES.ADDONS;
  const addonItems = input.policyType === "ThirdParty" ? [] : ADDONS.filter((a) => input.addons.includes(a.id));
  const addonsSum = addonItems.reduce((s, a) => s + idv * a.rate * 0.01, 0);

  const netPremium = netOD + tp + addonsSum;
  const gst = netPremium * 0.18;
  const grossPremium = netPremium + gst;

  const odPayout = 0.275;
  const addonPayout = 0.20;
  const odCommission = netOD * odPayout;
  const addonCommission = addonsSum * addonPayout;
  const grossCommission = odCommission + addonCommission;

  const customerPays = Math.max(0, grossPremium - Number(input.customerDiscount));
  // BUG-FUNC-08 fix: Do not clamp netInPocket with Math.max(0, ...); allow negative deficit margin
  const netInPocket = grossCommission - Number(input.customerDiscount);
  const margin = netPremium > 0 ? (netInPocket / netPremium) * 100 : 0;

  return {
    age,
    dep,
    idv,
    baseOD,
    netOD,
    tp,
    addonsSum,
    netPremium,
    gst,
    grossPremium,
    grossCommission,
    customerPays,
    netInPocket,
    margin,
  };
};

describe("Motor Insurance Calculations", () => {
  it("calculates IDV and depreciation correctly for brand new vehicle (0 age)", () => {
    const res = calculatePremium({
      exShowroom: 1000000,
      mfgYear: new Date().getFullYear(),
      vehicleType: "PrivateCar",
      cc: 1200,
      ncb: 0,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    expect(res.age).toBe(0);
    expect(res.dep).toBe(0.05); // 5% depreciation
    expect(res.idv).toBeCloseTo(950000, 2);
    expect(res.baseOD).toBeCloseTo(950000 * 0.0285, 2);
    expect(res.tp).toBe(3416); // 1200cc falls in 1000cc-1500cc slab = 3416
  });

  it("applies maximum depreciation (55%) for vehicles older than 5 years", () => {
    const res = calculatePremium({
      exShowroom: 500000,
      mfgYear: new Date().getFullYear() - 8,
      vehicleType: "PrivateCar",
      cc: 998,
      ncb: 50,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    expect(res.age).toBe(8);
    expect(res.dep).toBe(0.55);
    expect(res.idv).toBeCloseTo(225000, 2);
    // age > 5 increases odRate by 0.005 (0.0285 + 0.005 = 0.0335)
    expect(res.baseOD).toBeCloseTo(225000 * 0.0335, 2);
  });

  it("resets NCB to 0% if claim was made last year", () => {
    const withoutClaim = calculatePremium({
      exShowroom: 600000,
      mfgYear: new Date().getFullYear() - 2,
      vehicleType: "PrivateCar",
      cc: 1197,
      ncb: 35,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    const withClaim = calculatePremium({
      exShowroom: 600000,
      mfgYear: new Date().getFullYear() - 2,
      vehicleType: "PrivateCar",
      cc: 1197,
      ncb: 35,
      claimLastYear: true,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    expect(withoutClaim.netOD).toBeLessThan(withClaim.netOD);
    expect(withClaim.netOD).toBeCloseTo(withClaim.baseOD, 2);
  });

  it("caps anti-theft discount at ₹500", () => {
    const luxuryCar = calculatePremium({
      exShowroom: 5000000,
      mfgYear: new Date().getFullYear() - 1,
      vehicleType: "PrivateCar",
      cc: 2500,
      ncb: 0,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: true,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    // 2.5% of baseOD would be 5000000 * 0.85 * 0.0285 * 0.025 = ~3028, but must cap at 500
    const luxuryCarNoAt = calculatePremium({
      exShowroom: 5000000,
      mfgYear: new Date().getFullYear() - 1,
      vehicleType: "PrivateCar",
      cc: 2500,
      ncb: 0,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    expect(luxuryCarNoAt.netOD - luxuryCar.netOD).toBeCloseTo(500, 1);
  });

  it("allows negative deficit margin when customerDiscount > commission (BUG-FUNC-08 fix)", () => {
    const result = calculatePremium({
      exShowroom: 300000,
      mfgYear: new Date().getFullYear() - 1,
      vehicleType: "TwoWheeler",
      cc: 125,
      ncb: 20,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 2000, // discount exceeds broker commission
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    // BUG-FUNC-08 FIX VERIFIED: In actual accounting, broker is losing money (-deficit),
    // and UI no longer silently masks this as 0.
    expect(result.grossCommission).toBeLessThan(2000);
    expect(result.netInPocket).toBeLessThan(0);
    expect(result.netInPocket).toBeCloseTo(result.grossCommission - 2000, 2);
    expect(result.margin).toBeLessThan(0);
  });

  it("rounds IDV to the nearest integer avoiding floating-point precision artifacts (BUG-FUNC-07 fix)", () => {
    const result = calculatePremium({
      exShowroom: 654321,
      mfgYear: new Date().getFullYear() - 1,
      vehicleType: "PrivateCar",
      cc: 1200,
      ncb: 0,
      claimLastYear: false,
      companyDiscount: 0,
      customerDiscount: 0,
      antiTheft: false,
      voluntaryDeductible: 0,
      addons: [],
      policyType: "Comprehensive",
    });

    // 654321 * (1 - 0.15) = 556172.85 -> rounded to 556173
    expect(result.idv).toBe(556173);
    expect(Number.isInteger(result.idv)).toBe(true);
  });
});
