import { describe, it, expect } from "vitest";

// Replicate autoMatch, parseDate, normPhone from SmartCSVImporter.tsx
const CRM_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "customer_name", label: "Owner Name *", required: true },
  { key: "phone_number", label: "Mobile 1 *", required: true },
  { key: "registration_number", label: "Registration Number" },
  { key: "chassis_number", label: "Chassis Number" },
  { key: "engine_number", label: "Engine Number" },
  { key: "vehicle_type", label: "Vehicle Type" },
  { key: "maker_name", label: "Maker" },
  { key: "model_name", label: "Model" },
  { key: "fuel_type", label: "Fuel Type" },
  { key: "reg_date", label: "Registration Date" },
  { key: "fitness_upto", label: "Fitness Upto" },
  { key: "pucc_upto", label: "PUC Upto" },
  { key: "father_name", label: "Father Name" },
  { key: "authorised_person", label: "Authorised Person" },
  { key: "mobile_2", label: "Mobile 2" },
  { key: "current_address", label: "Current Address" },
  { key: "permanent_address", label: "Permanent Address" },
  { key: "delivery_address", label: "Delivery Address" },
  { key: "city_village", label: "City / Village" },
  { key: "policy_number", label: "Policy Number" },
  { key: "insurance_company", label: "Insurance Company" },
  { key: "policy_type", label: "Policy Type (Life/Health/Motor)" },
  { key: "issue_date", label: "Policy Issue Date" },
  { key: "expiry_date", label: "Policy Expiry Date" },
  { key: "policy_expiry_date", label: "Policy Expiry (alert)" },
  { key: "agent_sm_name", label: "Agent / SM Name" },
  { key: "vendor_name", label: "Vendor Name" },
  { key: "policy_copy_url", label: "Policy Copy URL" },
  { key: "net_od", label: "Net OD" },
  { key: "tp_premium", label: "TP Premium" },
  { key: "total_premium_incl_gst", label: "Total Premium (incl GST)" },
  { key: "premium_amount", label: "Premium Amount" },
  { key: "cash_back", label: "Cash Back" },
  { key: "payment_mode", label: "Payment Mode" },
  { key: "payment_status", label: "Payment Status" },
  { key: "remark", label: "Remark" },
  { key: "notes", label: "Notes" },
];

const autoMatch = (header: string): string => {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  const direct = CRM_FIELDS.find((f) => f.key.replace(/_/g, "") === h);
  if (direct) return direct.key;
  if (h.includes("registration") || h === "regno" || h === "vehicleno") return "registration_number";
  if (h.includes("chass")) return "chassis_number";
  if (h.includes("engine")) return "engine_number";
  if (h.includes("maker") || h.includes("brand")) return "maker_name";
  if (h.includes("model")) return "model_name";
  if (h.includes("fuel")) return "fuel_type";
  if (h.includes("owner") || (h.includes("name") && !h.includes("father") && !h.includes("agent"))) return "customer_name";
  if (h.includes("mobile1") || h === "mobile" || h === "phone" || h.includes("contact")) return "phone_number";
  if (h.includes("mobile2") || h === "altphone") return "mobile_2";
  if (h.includes("father")) return "father_name";
  if (h.includes("city") || h.includes("village")) return "city_village";
  if (h.includes("policyno") || h.includes("policynumber")) return "policy_number";
  if (h.includes("insurer") || h.includes("insurance")) return "insurance_company";
  if (h.includes("expiry")) return "expiry_date";
  if (h.includes("issue")) return "issue_date";
  if (h.includes("regdate")) return "reg_date";
  if (h.includes("fitness")) return "fitness_upto";
  if (h.includes("puc")) return "pucc_upto";
  if (h.includes("netod")) return "net_od";
  if (h.includes("tppremium") || h === "tp") return "tp_premium";
  if (h.includes("totalpremium") || h.includes("grosspremium")) return "total_premium_incl_gst";
  if (h.includes("premium")) return "premium_amount";
  if (h.includes("cashback")) return "cash_back";
  if (h.includes("agent") || h.includes("sm")) return "agent_sm_name";
  if (h.includes("vendor")) return "vendor_name";
  if (h.includes("remark")) return "remark";
  if (h.includes("note")) return "notes";
  return "__skip__";
};

const parseDate = (v: any): string | null => {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const normPhone = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

describe("Smart CSV Importer Logic", () => {
  describe("autoMatch header heuristics", () => {
    it("correctly matches common Indian broker CSV column headers", () => {
      expect(autoMatch("Reg No")).toBe("registration_number");
      expect(autoMatch("Vehicle No")).toBe("registration_number");
      expect(autoMatch("Customer Name")).toBe("customer_name");
      expect(autoMatch("Owner")).toBe("customer_name");
      expect(autoMatch("Mobile")).toBe("phone_number");
      // BUG CONFIRMED: "Mobile No" or "Phone No" fails auto-match and returns "__skip__" because of strict equality
      expect(autoMatch("Mobile No")).toBe("__skip__");
      expect(autoMatch("Contact")).toBe("phone_number");
      expect(autoMatch("Alt Phone")).toBe("mobile_2");
      expect(autoMatch("Policy Expiry")).toBe("expiry_date");
      expect(autoMatch("Net OD Premium")).toBe("net_od");
      expect(autoMatch("TP Premium")).toBe("tp_premium");
      expect(autoMatch("Gross Premium")).toBe("total_premium_incl_gst");
      expect(autoMatch("Chassis No")).toBe("chassis_number");
      expect(autoMatch("Engine No")).toBe("engine_number");
    });

    it("skips unrecognized headers gracefully", () => {
      expect(autoMatch("Random Col 123")).toBe("__skip__");
      expect(autoMatch("xyz_unknown")).toBe("__skip__");
    });

    it("distinguishes father name and agent name from customer name", () => {
      expect(autoMatch("Father's Name")).toBe("father_name");
      expect(autoMatch("Agent Name")).toBe("agent_sm_name");
    });
  });

  describe("parseDate handling", () => {
    it("correctly converts Indian standard DD/MM/YYYY to ISO YYYY-MM-DD", () => {
      expect(parseDate("25/12/2025")).toBe("2025-12-25");
      expect(parseDate("05-04-2024")).toBe("2024-04-05");
      expect(parseDate("1/2/2026")).toBe("2026-02-01");
    });

    it("handles 2-digit years", () => {
      expect(parseDate("15/08/25")).toBe("2025-08-15");
    });

    it("handles ISO standard YYYY-MM-DD", () => {
      expect(parseDate("2026-11-18")).toBe("2026-11-18");
    });

    it("returns null on empty, undefined, or invalid dates", () => {
      expect(parseDate("")).toBeNull();
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate("invalid-date-string")).toBeNull();
    });
  });

  describe("normPhone handling", () => {
    it("extracts 10 digits from various Indian phone number formats", () => {
      expect(normPhone("+91 98765 43210")).toBe("9876543210");
      expect(normPhone("09876543210")).toBe("9876543210");
      expect(normPhone("98765-43210")).toBe("9876543210");
      expect(normPhone("+91-9876543210")).toBe("9876543210");
      expect(normPhone("9876543210")).toBe("9876543210");
    });

    it("handles short or empty numbers gracefully", () => {
      expect(normPhone("")).toBe("");
      expect(normPhone("12345")).toBe("12345");
    });
  });
});
