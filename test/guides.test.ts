import { describe, expect, it } from "vitest";
import { hasIds, idsFromUrl, links, metaKeySteps } from "../app/lib/ads/guides";

describe("reading account ids from a pasted link", () => {
  it("Meta Ads Manager and Business Suite links", () => {
    expect(idsFromUrl("https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456789012345&business_id=987654321098765&nav_entry_point=lep_237")).toEqual({
      metaAdAccountId: "123456789012345",
      metaBusinessId: "987654321098765",
    });
    expect(idsFromUrl("business.facebook.com/latest/home?asset_id=111&business_id=2222222222")).toEqual({ metaBusinessId: "2222222222" });
    expect(idsFromUrl("https://www.facebook.com/adsmanager/manage/ads?act=act_55555555")).toEqual({ metaAdAccountId: "55555555" });
  });
  it("Google Ads links (ocid, signed-in account, customer id)", () => {
    expect(idsFromUrl("https://ads.google.com/aw/overview?ocid=7766554433&workspaceId=0&euid=1&__u=2&uscid=7766554433&__c=1234567890&authuser=1")).toEqual({
      googleOcid: "7766554433",
      googleAuthUser: "1",
      googleCustomerId: "123-456-7890",
    });
  });
  it("TikTok Ads Manager links", () => {
    expect(idsFromUrl("https://ads.tiktok.com/i18n/dashboard?aadvid=7123456789012345678")).toEqual({ tiktokAdvertiserId: "7123456789012345678" });
  });
  it("ignores unrelated text", () => {
    expect(idsFromUrl("hello")).toEqual({});
    expect(idsFromUrl("https://example.com/?act=123456")).toEqual({});
  });
});

describe("personalised links", () => {
  it("open the merchant's own business and ad account", () => {
    const ids = { metaBusinessId: "999999", metaAdAccountId: "123456" };
    expect(links.meta.systemUsers(ids)).toBe("https://business.facebook.com/latest/settings/system_users?business_id=999999");
    expect(links.meta.ads(ids)).toBe("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123456&business_id=999999");
    expect(links.google.scripts({ googleOcid: "77665", googleAuthUser: "1" })).toBe("https://ads.google.com/aw/bulk/scripts?ocid=77665&authuser=1");
    expect(links.tiktok.reporting({ tiktokAdvertiserId: "71234" })).toBe("https://ads.tiktok.com/i18n/reporting?aadvid=71234");
  });
  it("still work without ids (the platform opens the last-used account)", () => {
    expect(links.meta.systemUsers({})).toBe("https://business.facebook.com/latest/settings/system_users");
    expect(hasIds("meta", {})).toBe(false);
    expect(metaKeySteps({}).map((s) => s.id)).toContain("meta-paste");
  });
});
