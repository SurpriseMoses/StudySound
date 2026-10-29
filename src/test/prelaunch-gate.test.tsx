import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrelaunchGate from "@/components/PrelaunchGate";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: { user: null as null | { id: string }, loading: false, signOut: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.auth.user = null; });
const open = () => render(<MemoryRouter initialEntries={["/preview"]}><PrelaunchGate><div data-testid="private-content" /></PrelaunchGate></MemoryRouter>);

describe("prelaunch app access", () => {
  it("does not mount preview content for visitors", () => {
    open();
    expect(screen.queryByTestId("private-content")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("denies an existing learner even with a valid session", async () => {
    mocks.auth.user = { id: "existing-learner" };
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    open();
    await waitFor(() => expect(screen.queryByTestId("private-content")).toBeNull());
    expect(mocks.rpc).toHaveBeenCalledWith("prelaunch_access_allowed");
  });
  it("mounts the app only after server approval", async () => {
    mocks.auth.user = { id: "administrator" };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    open();
    expect(await screen.findByTestId("private-content")).toBeInTheDocument();
  });
  it("fails closed when server verification errors", async () => {
    mocks.auth.user = { id: "unverified" };
    mocks.rpc.mockResolvedValue({ data: true, error: { message: "unavailable" } });
    open();
    await screen.findByRole("button", { name: "Sign out" });
    expect(screen.queryByTestId("private-content")).toBeNull();
  });
});