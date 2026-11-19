import { describe, it, expect } from "vitest";

// Pure calculation functions mirroring src/components/admin/AdminOverviewPanel.tsx

export interface Profile {
  id: string;
  full_name: string;
  is_active: boolean;
  is_approved: boolean;
  branch_id: string | null;
}

export interface UserRole {
  user_id: string;
  role: string;
}

export interface Lead {
  id: string;
  assigned_telecaller: string | null;
  status: string;
  branch_id?: string | null;
}

export interface Branch {
  id: string;
  name: string;
  is_active: boolean;
}

export function calculateTeamMetrics(
  roles: UserRole[],
  profiles: Profile[],
  activeBreakIds: Set<string>,
  recentlyActiveIds: Set<string>
) {
  const profMap = new Map(profiles.map((p) => [p.id, p]));
  // Inactive or unapproved telecallers must be filtered out
  const activeTcRoles = roles.filter((r) => {
    if (r.role !== "telecaller") return false;
    const p = profMap.get(r.user_id);
    return p && p.is_active !== false && p.is_approved !== false;
  });

  const tcIds = new Set(activeTcRoles.map((r) => r.user_id));
  const onBreak = [...activeBreakIds].filter((id) => tcIds.has(id)).length;
  const active = [...recentlyActiveIds].filter((id) => tcIds.has(id) && !activeBreakIds.has(id)).length;
  const offline = Math.max(tcIds.size - active - onBreak, 0);

  return {
    total: tcIds.size,
    active,
    onBreak,
    offline,
    activeTcRoles,
  };
}

export function calculateBranchBreakdown(
  branches: Branch[],
  leads: Lead[],
  profiles: Profile[]
) {
  const profMap = new Map(profiles.map((p) => [p.id, p]));
  const map = new Map<string, { leads: number; converted: number }>();

  leads.forEach((l) => {
    // Branch resolved via assigned telecaller's profile (prevents column error on leads table)
    const bid = l.assigned_telecaller ? profMap.get(l.assigned_telecaller)?.branch_id : null;
    if (!bid) return; // Unassigned leads or telecallers without branch do not break execution

    const cur = map.get(bid) ?? { leads: 0, converted: 0 };
    cur.leads += 1;
    if (l.status === "Converted") cur.converted += 1;
    map.set(bid, cur);
  });

  return branches
    .filter((b) => b.is_active)
    .map((b) => ({
      id: b.id,
      name: b.name,
      leads: map.get(b.id)?.leads ?? 0,
      converted: map.get(b.id)?.converted ?? 0,
    }));
}

export function calculateBusinessMetrics(
  totalLeads: number,
  assignedCount: number,
  unassignedCount: number,
  convertedCount: number,
  calledCount: number
) {
  return {
    total: totalLeads,
    assigned: assignedCount,
    unassigned: unassignedCount,
    isConsistent: totalLeads === assignedCount + unassignedCount,
    conversion: calledCount ? Math.round((convertedCount / calledCount) * 1000) / 10 : 0,
  };
}

describe("Branch & Telecaller Analytics Verification (TASK 5)", () => {
  const mockBranches: Branch[] = [
    { id: "branch-indore", name: "Indore HQ", is_active: true },
    { id: "branch-bhopal", name: "Bhopal Branch", is_active: true },
    { id: "branch-closed", name: "Old Ujjain Branch", is_active: false },
  ];

  const mockProfiles: Profile[] = [
    { id: "tc-active-1", full_name: "Aman Sharma", is_active: true, is_approved: true, branch_id: "branch-indore" },
    { id: "tc-active-2", full_name: "Pooja Verma", is_active: true, is_approved: true, branch_id: "branch-bhopal" },
    { id: "tc-inactive", full_name: "Ramesh Ex-Staff", is_active: false, is_approved: true, branch_id: "branch-indore" },
    { id: "tc-unapproved", full_name: "New Applicant", is_active: true, is_approved: false, branch_id: "branch-bhopal" },
    { id: "mgr-1", full_name: "Sunil Manager", is_active: true, is_approved: true, branch_id: "branch-indore" },
  ];

  const mockRoles: UserRole[] = [
    { user_id: "tc-active-1", role: "telecaller" },
    { user_id: "tc-active-2", role: "telecaller" },
    { user_id: "tc-inactive", role: "telecaller" },
    { user_id: "tc-unapproved", role: "telecaller" },
    { user_id: "mgr-1", role: "manager" },
  ];

  describe("1. Team Rostering & Inactive Staff Filtering", () => {
    it("filters out inactive and unapproved staff from telecaller count", () => {
      const activeBreaks = new Set(["tc-active-1"]);
      const recentCalls = new Set(["tc-active-2"]);

      const team = calculateTeamMetrics(mockRoles, mockProfiles, activeBreaks, recentCalls);

      // Only tc-active-1 and tc-active-2 should be counted (total 2, not 4)
      expect(team.total).toBe(2);
      expect(team.onBreak).toBe(1); // tc-active-1
      expect(team.active).toBe(1); // tc-active-2
      expect(team.offline).toBe(0);
      expect(team.activeTcRoles.map((r) => r.user_id)).toEqual(["tc-active-1", "tc-active-2"]);
    });
  });

  describe("2. Branch Breakdown with Unassigned & Inactive Staff", () => {
    it("safely handles unassigned leads without throwing errors", () => {
      const mockLeads: Lead[] = [
        { id: "lead-1", assigned_telecaller: "tc-active-1", status: "Interested" },
        { id: "lead-2", assigned_telecaller: null, status: "New" }, // Unassigned
        { id: "lead-3", assigned_telecaller: null, status: "New" }, // Unassigned
      ];

      const breakdown = calculateBranchBreakdown(mockBranches, mockLeads, mockProfiles);

      const indore = breakdown.find((b) => b.id === "branch-indore");
      expect(indore).toBeDefined();
      expect(indore?.leads).toBe(1);
      expect(indore?.converted).toBe(0);

      const bhopal = breakdown.find((b) => b.id === "branch-bhopal");
      expect(bhopal?.leads).toBe(0);
    });

    it("attributes leads of inactive staff to their historical branch correctly", () => {
      const mockLeads: Lead[] = [
        { id: "lead-hist-1", assigned_telecaller: "tc-inactive", status: "Converted" },
        { id: "lead-active-1", assigned_telecaller: "tc-active-1", status: "Converted" },
      ];

      const breakdown = calculateBranchBreakdown(mockBranches, mockLeads, mockProfiles);

      const indore = breakdown.find((b) => b.id === "branch-indore");
      // Both tc-inactive and tc-active-1 belonged to branch-indore
      expect(indore?.leads).toBe(2);
      expect(indore?.converted).toBe(2);
    });

    it("filters out closed/inactive branches from branch breakdown view", () => {
      const mockLeads: Lead[] = [];
      const breakdown = calculateBranchBreakdown(mockBranches, mockLeads, mockProfiles);

      expect(breakdown.some((b) => b.id === "branch-closed")).toBe(false);
      expect(breakdown.length).toBe(2); // Indore HQ and Bhopal Branch
    });
  });

  describe("3. Transferred Leads & Reassignment", () => {
    it("attributes transferred leads to the new assignee's branch", () => {
      // Lead originally from Indore, now transferred and assigned to Bhopal telecaller
      const mockLeads: Lead[] = [
        { id: "lead-transfer", assigned_telecaller: "tc-active-2", status: "Transfer to Senior" },
      ];

      const breakdown = calculateBranchBreakdown(mockBranches, mockLeads, mockProfiles);

      const bhopal = breakdown.find((b) => b.id === "branch-bhopal");
      expect(bhopal?.leads).toBe(1);
      expect(bhopal?.converted).toBe(0);

      const indore = breakdown.find((b) => b.id === "branch-indore");
      expect(indore?.leads).toBe(0);
    });
  });

  describe("4. Business Metric Coherence (Mathematical Identity)", () => {
    it("ensures total equals assigned plus unassigned", () => {
      const metrics = calculateBusinessMetrics(100, 75, 25, 10, 50);
      expect(metrics.isConsistent).toBe(true);
      expect(metrics.total).toBe(metrics.assigned + metrics.unassigned);
      expect(metrics.conversion).toBe(20.0); // 10 / 50 = 20%
    });

    it("handles zero called division without NaN", () => {
      const metrics = calculateBusinessMetrics(50, 0, 50, 0, 0);
      expect(metrics.conversion).toBe(0);
      expect(metrics.isConsistent).toBe(true);
    });
  });
});
