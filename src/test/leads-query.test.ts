import { describe, it, expect } from "vitest";

// Replication of search normalization logic from src/hooks/useLeadsPaginated.ts
export function buildSearchQueryFilters(search: string) {
  const trimmed = search.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  let phoneFilter = "";
  if (digits.length >= 5) {
    phoneFilter = `,phone_number.ilike.%${digits}%`;
  }
  return `customer_name.ilike.%${trimmed}%${phoneFilter}`;
}

// Replication of queue date filtering from src/hooks/useLeadsPaginated.ts
export function getQueueFilterCriteria(activeTab: string, todayStr: string) {
  if (activeTab === "today") {
    return {
      call_date_eq: todayStr,
      last_called_or: `last_called_at.is.null,last_called_at.lt.${todayStr}T00:00:00`,
    };
  }
  if (activeTab === "pending") {
    return {
      status_eq: "Pending",
    };
  }
  if (activeTab === "followup") {
    return {
      status_eq: "Follow Up",
    };
  }
  return {};
}

describe("Lead Search Normalization (BUG-FUNC-05)", () => {
  it("normalizes raw 10-digit phone number in search", () => {
    const filter = buildSearchQueryFilters("9876543210");
    expect(filter).toBe("customer_name.ilike.%9876543210%,phone_number.ilike.%9876543210%");
  });

  it("normalizes phone number with international prefix and spaces", () => {
    const filter = buildSearchQueryFilters("+91 98765 43210");
    expect(filter).toBe("customer_name.ilike.%+91 98765 43210%,phone_number.ilike.%919876543210%");
  });

  it("normalizes phone number with hyphens", () => {
    const filter = buildSearchQueryFilters("98765-43210");
    expect(filter).toBe("customer_name.ilike.%98765-43210%,phone_number.ilike.%9876543210%");
  });

  it("does not attach phone search filter for plain customer names without sufficient digits", () => {
    const filter = buildSearchQueryFilters("Rahul Sharma");
    expect(filter).toBe("customer_name.ilike.%Rahul Sharma%");
  });

  it("attaches phone filter when name query contains 5 or more digits", () => {
    const filter = buildSearchQueryFilters("MH02-12345");
    expect(filter).toBe("customer_name.ilike.%MH02-12345%,phone_number.ilike.%0212345%");
  });
});

describe("Calling Queue Filtering (BUG-FUNC-06)", () => {
  const today = "2026-11-18";

  it("restricts 'today' queue strictly to leads with call_date = today", () => {
    const criteria = getQueueFilterCriteria("today", today);
    expect(criteria.call_date_eq).toBe("2026-11-18");
  });

  it("includes leads that have never been called or were called prior to today", () => {
    const criteria = getQueueFilterCriteria("today", today);
    expect(criteria.last_called_or).toBe(
      "last_called_at.is.null,last_called_at.lt.2026-11-18T00:00:00"
    );
  });

  it("filters accurately for other tabs", () => {
    expect(getQueueFilterCriteria("pending", today).status_eq).toBe("Pending");
    expect(getQueueFilterCriteria("followup", today).status_eq).toBe("Follow Up");
  });
});
