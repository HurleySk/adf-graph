import { describe, it, expect } from "vitest";
import {
  makeNodeId, makeActivityId, parseNodeId, parseActivityId, inferNodeType,
  makeTableId, makeEntityId, makePipelineId, makeSpId, makeDatasetId,
  makeLinkedServiceId, makeKeyVaultSecretId, makeAttributeId,
} from "../../src/utils/nodeId.js";
import { NodeType } from "../../src/graph/model.js";

describe("makeNodeId", () => {
  it("creates a node ID from type and name", () => {
    expect(makeNodeId("pipeline", "MyPipeline")).toBe("pipeline:MyPipeline");
  });
});

describe("makeActivityId", () => {
  it("creates an activity ID from pipeline, prefix, and activity names", () => {
    expect(makeActivityId("MyPipeline", "", "CopyData")).toBe("activity:MyPipeline/CopyData");
  });

  it("creates an activity ID with a container prefix", () => {
    expect(makeActivityId("MyPipeline", "Container/", "CopyData")).toBe("activity:MyPipeline/Container/CopyData");
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

describe("semantic node ID helpers", () => {
  it("makeTableId creates table node ID", () => {
    expect(makeTableId("dbo", "Org_Staging")).toBe("table:dbo.Org_Staging");
  });

  it("makeEntityId creates entity node ID", () => {
    expect(makeEntityId("alm_organization")).toBe("dataverse_entity:alm_organization");
  });

  it("makePipelineId creates pipeline node ID", () => {
    expect(makePipelineId("Copy_To_Staging")).toBe("pipeline:Copy_To_Staging");
  });

  it("makeSpId creates stored procedure node ID", () => {
    expect(makeSpId("dbo", "p_Transform_Org")).toBe("stored_procedure:dbo.p_Transform_Org");
  });

  it("makeActivityId creates activity node ID with prefix", () => {
    expect(makeActivityId("MyPipeline", "Container/", "CopyData")).toBe("activity:MyPipeline/Container/CopyData");
  });

  it("makeActivityId creates activity node ID without prefix", () => {
    expect(makeActivityId("MyPipeline", "", "CopyData")).toBe("activity:MyPipeline/CopyData");
  });

  it("makeDatasetId creates dataset node ID", () => {
    expect(makeDatasetId("DS_Source")).toBe("dataset:DS_Source");
  });

  it("makeLinkedServiceId creates linked service node ID", () => {
    expect(makeLinkedServiceId("LS_SqlServer")).toBe("linked_service:LS_SqlServer");
  });

  it("makeKeyVaultSecretId creates key vault secret node ID", () => {
    expect(makeKeyVaultSecretId("my-secret")).toBe("key_vault_secret:my-secret");
  });

  it("makeAttributeId creates attribute node ID", () => {
    expect(makeAttributeId("alm_organization", "alm_name")).toBe("dataverse_attribute:alm_organization.alm_name");
  });
});
