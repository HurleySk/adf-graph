import { describe, it, expect } from "vitest";
import { detectCdcPattern, isCdcPipeline, classifyStagingRole } from "../../src/utils/cdcPatterns.js";

describe("isCdcPipeline", () => {
  it("returns true when at least 2 CDC params are present", () => {
    expect(isCdcPipeline({
      cdc_current_table: "CDC_Work_Item_Current",
      cdc_historical_table: "CDC_Work_Item_Historical",
    })).toBe(true);
  });

  it("returns false with only 1 CDC param", () => {
    expect(isCdcPipeline({
      cdc_current_table: "CDC_Work_Item_Current",
      source_object_name: "Work_Item",
    })).toBe(false);
  });

  it("returns false with no CDC params", () => {
    expect(isCdcPipeline({
      source_object_name: "Work_Item",
      dest_object_name: "Staging",
    })).toBe(false);
  });

  it("ignores empty string CDC params", () => {
    expect(isCdcPipeline({
      cdc_current_table: "",
      cdc_historical_table: "",
      cdc_source_table_name: "dbo_Work_Item_CT",
      cdc_pending_table_name: "Pending",
    })).toBe(true);
  });
});

describe("detectCdcPattern", () => {
  it("extracts all CDC fields from params", () => {
    const info = detectCdcPattern({
      cdc_current_table: "CDC_WI_Current",
      cdc_historical_table: "CDC_WI_Historical",
      cdc_source_table_name: "dbo_Work_Item_CT",
      stored_procedure: "[dbo].[p_InsertProcessedTransactionsAndDelete]",
      source_object_name: "Work_Item",
      dest_object_name: "Agenda_WI_Staging",
      dataverse_entity_name: "pcx_workpackage",
      source_query: "SELECT * FROM dbo.Work_Item",
      dest_query: "SELECT * FROM dbo.Staging WHERE active = 1",
    });

    expect(info.isCdc).toBe(true);
    expect(info.cdcCurrentTable).toBe("CDC_WI_Current");
    expect(info.cdcHistoricalTable).toBe("CDC_WI_Historical");
    expect(info.cdcSourceTableName).toBe("dbo_Work_Item_CT");
    expect(info.storedProcedure).toBe("[dbo].[p_InsertProcessedTransactionsAndDelete]");
    expect(info.dataverseEntity).toBe("pcx_workpackage");
  });

  it("handles Expression-typed values", () => {
    const info = detectCdcPattern({
      cdc_current_table: { value: "CDC_WI_Current", type: "Expression" },
      cdc_historical_table: { value: "CDC_WI_Historical", type: "Expression" },
    });

    expect(info.isCdc).toBe(true);
    expect(info.cdcCurrentTable).toBe("CDC_WI_Current");
  });

  it("returns null fields for missing params", () => {
    const info = detectCdcPattern({ source_object_name: "Work_Item" });
    expect(info.isCdc).toBe(false);
    expect(info.cdcCurrentTable).toBeNull();
    expect(info.storedProcedure).toBeNull();
  });
});

describe("classifyStagingRole", () => {
  const cdc = detectCdcPattern({
    cdc_current_table: "CDC_Work_Item_Current",
    cdc_historical_table: "CDC_Work_Item_Historical",
    cdc_pending_table_name: "CDC_Work_Item_Pending",
    dest_object_name: "Agenda_Work_Item_Staging",
    source_object_name: "Work_Item",
  });

  it("identifies cdc_current from param match", () => {
    expect(classifyStagingRole("CDC_Work_Item_Current", cdc)).toBe("cdc_current");
  });

  it("identifies cdc_historical from param match", () => {
    expect(classifyStagingRole("CDC_Work_Item_Historical", cdc)).toBe("cdc_historical");
  });

  it("identifies cdc_pending from param match", () => {
    expect(classifyStagingRole("CDC_Work_Item_Pending", cdc)).toBe("cdc_pending");
  });

  it("identifies staging from dest_object_name match", () => {
    expect(classifyStagingRole("Agenda_Work_Item_Staging", cdc)).toBe("staging");
  });

  it("identifies source from source_object_name match", () => {
    expect(classifyStagingRole("Work_Item", cdc)).toBe("source");
  });

  it("falls back to naming convention", () => {
    const emptyCdc = detectCdcPattern({
      cdc_current_table: "X",
      cdc_historical_table: "Y",
    });
    expect(classifyStagingRole("CDC_Other_Current", emptyCdc)).toBe("cdc_current");
    expect(classifyStagingRole("Some_Staging", emptyCdc)).toBe("staging");
  });

  it("returns unknown for unrecognized tables", () => {
    expect(classifyStagingRole("RandomTable", cdc)).toBe("unknown");
  });
});
