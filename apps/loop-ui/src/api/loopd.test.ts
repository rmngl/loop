import { describe, expect, it } from "vitest";
import { companyPath, withCompanyBase } from "./loopd";

describe("loopd client", () => {
  it("companyPath scopes API under company_id", () => {
    expect(companyPath("http://127.0.0.1:7841", "abc", "/tickets")).toBe(
      "http://127.0.0.1:7841/v1/companies/abc/tickets"
    );
  });

  it("withCompanyBase returns company-scoped base", () => {
    expect(withCompanyBase("http://127.0.0.1:7841", "xyz")).toBe(
      "http://127.0.0.1:7841/v1/companies/xyz"
    );
  });
});