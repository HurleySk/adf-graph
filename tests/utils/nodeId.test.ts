import { describe, it, expect } from "vitest";
import { makeNodeId, makeActivityId, parseNodeId, parseActivityId, inferNodeType } from "../../src/utils/nodeId.js";
import { NodeType } from "../../src/graph/model.js";

describe("makeNodeId", () => {
  it("creates a node ID from type and name", () => {
    expect(makeNodeId("pipeline", "MyPipeline")).toBe("pipeline:MyPipeline");
  });
});

describe("makeActivityId", () => {
  it("creates an activity ID from pipeline and activity names", () => {
    expect(makeActivityId("MyPipeline", "CopyData")).toBe("activity:MyPipeline/CopyData");
  });
});

describe("parseNodeId", () => {
  it("splits a node ID into type and name", () => {
    expect(parseNodeId("pipeline:MyPipeline")).toEqual({ type: "pipeline", name: "MyPipeline" });
  });

  it("handles names containing colons", () => {
    expect(parseNodeId("table:dbo.my_table")).toEqual({ type: "table", name: "dbo.my_table" });
  });

  it("handles IDs with no colon", () => {
    expect(parseNodeId("noprefix")).toEqual({ type: "", name: "noprefix" });
  });
});

describe("parseActivityId", () => {
  it("splits an activity ID into pipeline and activity", () => {
    expect(parseActivityId("activity:MyPipeline/CopyData")).toEqual({
      pipeline: "MyPipeline",
      activity: "CopyData",
    });
  });

  it("handles activity IDs without prefix", () => {
    expect(parseActivityId("MyPipeline/CopyData")).toEqual({
      pipeline: "MyPipeline",
      activity: "CopyData",
    });
  });

  it("handles IDs with no slash", () => {
    expect(parseActivityId("activity:Standalone")).toEqual({
      pipeline: "Standalone",
      activity: "Standalone",
    });
  });
});

describe("inferNodeType", () => {
  it("infers Pipeline from pipeline: prefix", () => {
    expect(inferNodeType("pipeline:Foo")).toBe(NodeType.Pipeline);
  });

  it("infers Activity from activity: prefix", () => {
    expect(inferNodeType("activity:P/A")).toBe(NodeType.Activity);
  });

  it("infers Table from table: prefix", () => {
    expect(inferNodeType("table:dbo.t")).toBe(NodeType.Table);
  });

  it("returns null for unknown prefix", () => {
    expect(inferNodeType("unknown:something")).toBeNull();
  });

  it("infers DataverseAttribute from dataverse_attribute prefix", () => {
    expect(inferNodeType("dataverse_attribute:alm_org.alm_name")).toBe(NodeType.DataverseAttribute);
  });
});
