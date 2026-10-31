import { describe, expect, it } from "vitest";
import { csvCell, csvLine, parseCsv, splitTags } from "@/lib/crm/csv";
import { coerceFieldValue, fieldKeyFromLabel, FieldValueError, mergeFieldValues, type FieldDef } from "@/lib/crm/fields";
import { guessMapping } from "@/lib/crm/imports";
import { positionBetween } from "@/lib/crm/pipelines";
import { compileSegment, SegmentError } from "@/lib/crm/segments";
import { endOfDayIn } from "@/lib/time";

const def = (type: FieldDef["type"], options: string[] = []): FieldDef => ({ key: "f", label: "Field", type, options });

describe("custom field values", () => {
  it("coerces each type", () => {
    expect(coerceFieldValue(def("NUMBER"), "1,250.5")).toBe(1250.5);
    expect(coerceFieldValue(def("DATE"), "2026-02-28")).toBe("2026-02-28");
    expect(coerceFieldValue(def("DATE"), "March 3, 2026")).toBe("2026-03-03");
    expect(coerceFieldValue(def("DATE"), "15/10/2026")).toBe("2026-10-15");
    expect(coerceFieldValue(def("DATE"), "10/15/2026")).toBe("2026-10-15");
    expect(coerceFieldValue(def("DATE"), "2026-3-7")).toBe("2026-03-07");
    expect(coerceFieldValue(def("BOOLEAN"), "Yes")).toBe(true);
    expect(coerceFieldValue(def("BOOLEAN"), "0")).toBe(false);
    expect(coerceFieldValue(def("SELECT", ["Gold", "Silver"]), "gold")).toBe("Gold");
    expect(coerceFieldValue(def("EMAIL"), "Ravi@Example.com")).toBe("ravi@example.com");
    expect(coerceFieldValue(def("TEXT"), "  hi  ")).toBe("hi");
    expect(coerceFieldValue(def("TEXT"), "   ")).toBeNull();
  });

  it("rejects values that don't fit", () => {
    expect(() => coerceFieldValue(def("NUMBER"), "abc")).toThrow(FieldValueError);
    expect(() => coerceFieldValue(def("DATE"), "2026-02-30")).toThrow(FieldValueError);
    expect(() => coerceFieldValue(def("SELECT", ["Gold"]), "Bronze")).toThrow(FieldValueError);
    expect(() => coerceFieldValue(def("URL"), "javascript:alert(1)")).toThrow(FieldValueError);
    expect(() => coerceFieldValue(def("BOOLEAN"), "maybe")).toThrow(FieldValueError);
  });

  it("merges updates, clears empties and refuses unknown keys", () => {
    const defs: FieldDef[] = [
      { key: "city", label: "City", type: "TEXT", options: [] },
      { key: "spend", label: "Spend", type: "NUMBER", options: [] },
    ];
    expect(mergeFieldValues(defs, { city: "Delhi", spend: 5 }, { spend: "10", city: "" })).toEqual({ spend: 10 });
    expect(() => mergeFieldValues(defs, {}, { hacked: "x" })).toThrow(/Unknown field/);
  });

  it("derives keys from labels", () => {
    expect(fieldKeyFromLabel("Order #ID / Ref")).toBe("order_id_ref");
    expect(fieldKeyFromLabel("2nd phone")).toBe("f_2nd_phone");
    expect(fieldKeyFromLabel("!!!")).toBe("field");
  });
});

describe("CSV", () => {
  it("parses BOM, quotes, semicolons and blank lines", () => {
    const parsed = parseCsv(Buffer.from('\uFEFFName;Phone;Notes\r\n"Sharma, Ravi";+91 90000 12345;"said ""hi"""\r\n\r\nAsha;9000022233;\r\n'));
    expect(parsed.header).toEqual(["Name", "Phone", "Notes"]);
    expect(parsed.rows).toEqual([
      ["Sharma, Ravi", "+91 90000 12345", 'said "hi"'],
      ["Asha", "9000022233", ""],
    ]);
  });

  it("escapes cells and neutralises spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell(null)).toBe("");
    expect(csvLine(["a", 1, true])).toBe("a,1,true\r\n");
  });

  it("splits tag cells", () => {
    expect(splitTags("VIP, Delhi; Wholesale|VIP")).toEqual(["VIP", "Delhi", "Wholesale"]);
  });

  it("guesses the column mapping", () => {
    expect(guessMapping(["Full Name", "Mobile Number", "E-mail", "Labels", "City", "Notes", "Phone"], [{ key: "city", label: "City" }])).toEqual([
      "name",
      "phone",
      "email",
      "tags",
      "field:city",
      "ignore",
      "ignore", // phone is already taken by "Mobile Number"
    ]);
  });
});

describe("partial updates", () => {
  it("don't reset fields that weren't sent", async () => {
    const { dealBodySchema } = await import("@/lib/crm/pipelines");
    const { flowSettingsSchema } = await import("@/lib/flows/schema");
    expect(dealBodySchema.partial().parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
    expect(flowSettingsSchema.partial().parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

describe("deal ordering", () => {
  it("places between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(1024, null)).toBe(2048);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});

describe("segments", () => {
  const fields: FieldDef[] = [{ key: "spend", label: "Spend", type: "NUMBER", options: [] }];

  it("combines conditions with all/any", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const all = compileSegment({ match: "all", conditions: [{ type: "opted_out", value: false }, { type: "created", op: "within_days", days: 7 }] }, fields, now);
    expect(all).toEqual({ AND: [{ optedOut: false }, { createdAt: { gte: new Date("2026-10-08T00:00:00Z") } }] });
    const any = compileSegment({ match: "any", conditions: [{ type: "tag", op: "has", tagId: "t1" }] }, fields, now);
    expect(any).toEqual({ OR: [{ tags: { some: { tagId: "t1" } } }] });
    expect(compileSegment({ match: "all", conditions: [] }, fields)).toEqual({});
  });

  it("validates field conditions", () => {
    expect(() => compileSegment({ match: "all", conditions: [{ type: "field", key: "gone", op: "eq", value: "x" }] }, fields)).toThrow(SegmentError);
    expect(() => compileSegment({ match: "all", conditions: [{ type: "field", key: "spend", op: "gt", value: "lots" }] }, fields)).toThrow(SegmentError);
    expect(compileSegment({ match: "all", conditions: [{ type: "field", key: "spend", op: "gt", value: "100" }] }, fields)).toEqual({
      AND: [{ fields: { path: ["spend"], gt: 100 } }],
    });
  });
});

describe("time zones", () => {
  it("finds the end of the local day", () => {
    // 20:00 UTC on Oct 15 is already Oct 16 01:30 in India
    const at = new Date("2026-10-15T20:00:00Z");
    expect(endOfDayIn("Asia/Kolkata", at).toISOString()).toBe("2026-10-16T18:29:59.999Z");
    expect(endOfDayIn("UTC", at).toISOString()).toBe("2026-10-15T23:59:59.999Z");
    expect(endOfDayIn("America/New_York", at).toISOString()).toBe("2026-10-16T03:59:59.999Z");
  });
});
