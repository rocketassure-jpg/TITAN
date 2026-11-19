import { describe, it, expect } from "vitest";
import { maskPhone, formatPhone } from "@/lib/utils";

describe("Phone Masking & Formatting", () => {
  describe("maskPhone utility", () => {
    it("masks 10-digit Indian phone numbers showing only the last 4 digits", () => {
      expect(maskPhone("9893037946")).toBe("XXXXXX 7946");
      expect(maskPhone("9123456789")).toBe("XXXXXX 6789");
    });

    it("handles country code prefix (+91)", () => {
      expect(maskPhone("+919893037946")).toBe("+91 XXXXXX 7946");
    });

    it("handles formatted numbers with dashes or spaces", () => {
      expect(maskPhone("98930-37946")).toBe("XXXXXX 7946");
      expect(maskPhone("+91 98930 37946")).toBe("+91 XXXXXX 7946");
    });

    it("returns dash for null, undefined, or empty string", () => {
      expect(maskPhone(null)).toBe("—");
      expect(maskPhone(undefined)).toBe("—");
      expect(maskPhone("")).toBe("—");
    });

    it("returns raw input if digits count is less than 5", () => {
      expect(maskPhone("123")).toBe("123");
      expect(maskPhone("9874")).toBe("9874");
    });
  });

  describe("formatPhone utility", () => {
    it("formats 10-digit numbers into standard 5+5 format", () => {
      expect(formatPhone("9893037946")).toBe("98930 37946");
    });

    it("formats 12-digit international numbers with country prefix", () => {
      expect(formatPhone("919893037946")).toBe("+91 98930 37946");
    });

    it("returns dash for null, undefined, or empty string", () => {
      expect(formatPhone(null)).toBe("—");
      expect(formatPhone(undefined)).toBe("—");
      expect(formatPhone("")).toBe("—");
    });
  });
});
