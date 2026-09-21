import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseParams = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useParams: () => mockUseParams() };
});

const mockUseGetSharedCallQuery = vi.fn();
vi.mock("@/features/scanner", () => ({
  useGetSharedCallQuery: (...args: unknown[]) =>
    mockUseGetSharedCallQuery(...args),
}));

import SharedCall from "./SharedCall";

describe("SharedCall", () => {
  it("shows loading spinner when fetching", () => {
    mockUseParams.mockReturnValue({ token: "abc-123-def" });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { container } = render(<SharedCall />);
    expect(container.querySelector(".loading-spinner")).toBeInTheDocument();
  });

  it('shows "Call not found" when error', () => {
    mockUseParams.mockReturnValue({ token: "abc-123-def" });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<SharedCall />);
    expect(screen.getByText("Call not found")).toBeInTheDocument();
  });

  it("shows call details when data loaded", () => {
    mockUseParams.mockReturnValue({ token: "abc-123-def" });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: {
        token: "abc-123-def",
        dateTime: 1700000000,
        systemLabel: "Test System",
        talkgroupLabel: "TG Alpha",
        talkgroupName: "Alpha Group",
        frequency: 851_000_000,
        duration: 5000,
        source: 123,
        audioUrl: "/api/shared/abc-123-def/audio",
      },
      isLoading: false,
      isError: false,
    });

    render(<SharedCall />);
    expect(screen.getByText("Shared Call")).toBeInTheDocument();
    expect(screen.getByText("Test System")).toBeInTheDocument();
    expect(screen.getByText(/TG Alpha/)).toBeInTheDocument();
    expect(screen.getByText("851.0000 MHz")).toBeInTheDocument();
  });

  it('shows "Call not found" when no data and not loading', () => {
    mockUseParams.mockReturnValue({ token: "nonexistent-token" });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    render(<SharedCall />);
    expect(screen.getByText("Call not found")).toBeInTheDocument();
  });

  it("offers the app handoff on a phone and not on a desktop", () => {
    const uuidToken = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    mockUseParams.mockReturnValue({ token: uuidToken });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: {
        token: uuidToken,
        dateTime: 1700000000,
        systemLabel: "Test System",
        talkgroupLabel: "TG Alpha",
        talkgroupName: "Alpha Group",
        frequency: 851_000_000,
        duration: 5000,
        source: 123,
        audioUrl: `/api/shared/${uuidToken}/audio`,
      },
      isLoading: false,
      isError: false,
    });

    const androidUA =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(androidUA);

    const phone = render(<SharedCall />);
    const link = screen.getByRole("link", { name: /open in app/i });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("intent://call/"),
    );
    phone.unmount();

    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    );
    render(<SharedCall />);
    expect(
      screen.queryByRole("link", { name: /open in app/i }),
    ).not.toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it("falls back when API returns an unsafe audio URL", () => {
    mockUseParams.mockReturnValue({ token: "abc-123-def" });
    mockUseGetSharedCallQuery.mockReturnValue({
      data: {
        token: "abc-123-def",
        dateTime: 1700000000,
        systemLabel: "Test System",
        talkgroupLabel: "TG Alpha",
        talkgroupName: "Alpha Group",
        frequency: 851_000_000,
        duration: 5000,
        source: 123,
        audioUrl: "javascript:alert(1)",
      },
      isLoading: false,
      isError: false,
    });

    render(<SharedCall />);
    expect(screen.getByText("Call not found")).toBeInTheDocument();
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
  });
});
