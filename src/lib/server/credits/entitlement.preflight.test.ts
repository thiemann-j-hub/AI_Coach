import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S4-4: Vorabprüfung vor dem Rollenspiel — leerer Saldo → 402 mit preflight:true,
 * Saldo ≥ 1 oder nicht lesbar → kein Block, Schalter COACH_PREFLIGHT=off → kein Block.
 */
const walletStatus = vi.fn();
const memberInfo = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/credits/credit-service", () => ({
  creditsCentralEnabled: () => true,
  centralReserve: vi.fn(),
  centralRefund: vi.fn(),
  centralWalletStatus: () => walletStatus(),
}));
vi.mock("@/lib/server/credits/member-info", () => ({
  getCentralMemberInfo: () => memberInfo(),
}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { oid: "oid-test" } }) }));
vi.mock("@/lib/logger", () => ({ logger: { apiError: vi.fn(), api: vi.fn() } }));

import { preflightEntitlement, PREFLIGHT_TEXT } from "./entitlement";

describe("preflightEntitlement (S4-4)", () => {
  beforeEach(() => {
    delete process.env.COACH_PREFLIGHT;
    walletStatus.mockReset();
    memberInfo.mockReset();
    memberInfo.mockResolvedValue({ role: "admin" });
  });

  it("blockiert mit 402 und preflight:true, wenn der Saldo 0 ist", async () => {
    walletStatus.mockResolvedValue({ state: "active", workspaceId: "ws-1", credits: 0 });
    const res = await preflightEntitlement();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.preflight).toBe(true);
    expect(body.canTopUp).toBe(true);
    expect(body.error).toBe(PREFLIGHT_TEXT);
    expect(body.topUpUrl).toBeTruthy();
  });

  it("Mitglied ohne Kaufrecht: kein Kauf-Link, Mitgliedstext", async () => {
    walletStatus.mockResolvedValue({ state: "active", workspaceId: "ws-1", credits: 0 });
    memberInfo.mockResolvedValue({ role: "member" });
    const body = await (await preflightEntitlement())!.json();
    expect(body.canTopUp).toBe(false);
    expect(body.topUpUrl).toBeUndefined();
    expect(body.error).not.toBe(PREFLIGHT_TEXT);
  });

  it("lässt den Start zu, wenn mindestens 1 Credit da ist", async () => {
    walletStatus.mockResolvedValue({ state: "active", workspaceId: "ws-1", credits: 1 });
    expect(await preflightEntitlement()).toBeNull();
  });

  it("fail-open: nicht lesbarer Saldo blockiert den Start nicht", async () => {
    walletStatus.mockResolvedValue({ state: "inert" });
    expect(await preflightEntitlement()).toBeNull();
    walletStatus.mockResolvedValue({ state: "expired" });
    expect(await preflightEntitlement()).toBeNull();
    walletStatus.mockRejectedValue(new Error("down"));
    expect(await preflightEntitlement()).toBeNull();
  });

  it("Rückweg COACH_PREFLIGHT=off: keine Prüfung", async () => {
    process.env.COACH_PREFLIGHT = "off";
    walletStatus.mockResolvedValue({ state: "active", workspaceId: "ws-1", credits: 0 });
    expect(await preflightEntitlement()).toBeNull();
    expect(walletStatus).not.toHaveBeenCalled();
  });
});
