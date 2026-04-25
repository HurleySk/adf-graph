import { describe, it, expect } from "vitest";
import { join } from "path";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";
import { detectArtifactType, scanOverlayPath, mergeOverlayInto } from "../../src/graph/overlay.js";

describe("detectArtifactType", () => {
  it("detects pipeline from properties.activities", () => {
    const json = {
      name: "MyPipeline",
      properties: { activities: [{ name: "Act1", type: "Copy" }] },
    };
    expect(detectArtifactType(json)).toBe("pipeline");
  });

  it("detects dataset from properties.typeProperties + AzureSqlTable type", () => {
    const json = {
      name: "MyDataset",
      properties: {
        type: "AzureSqlTable",
        typeProperties: { schema: "dbo", table: "Foo" },
      },
    };
    expect(detectArtifactType(json)).toBe("dataset");
  });

  it("detects dataset from DelimitedText type", () => {
    const json = {
      name: "CsvDs",
      properties: {
        type: "DelimitedText",
        typeProperties: { location: {} },
      },
    };
    expect(detectArtifactType(json)).toBe("dataset");
  });

  it("returns null for unrecognized JSON", () => {
    expect(detectArtifactType({ name: "Unknown", properties: { foo: "bar" } })).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(detectArtifactType("not an object")).toBeNull();
    expect(detectArtifactType(null)).toBeNull();
  });
});

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("scanOverlayPath", () => {
  it("scans a structured overlay directory (has pipeline/ subdir)", () => {
    const overlayDir = join(fixtureRoot, "overlay-structured");
    const result = scanOverlayPath(overlayDir);
    expect(result.nodes.length).toBeGreaterThan(0);
    const pipelineNode = result.nodes.find((n) => n.name === "OverlayPipeline");
    expect(pipelineNode).toBeDefined();
  });

  it("scans loose files and detects types", () => {
    const overlayDir = join(fixtureRoot, "overlay-loose");
    const result = scanOverlayPath(overlayDir);
    const names = result.nodes.map((n) => n.name);
    expect(names).toContain("LoosePipeline");
    expect(names).toContain("LooseDataset");
    expect(result.warnings.every((w) => !w.includes("notes.txt"))).toBe(true);
  });

  it("scans a single file path", () => {
    const filePath = join(fixtureRoot, "overlay-loose", "LoosePipeline.json");
    const result = scanOverlayPath(filePath);
    expect(result.nodes.find((n) => n.name === "LoosePipeline")).toBeDefined();
  });

  it("returns empty for non-json file", () => {
    const filePath = join(fixtureRoot, "overlay-loose", "notes.txt");
    const result = scanOverlayPath(filePath);
    expect(result.nodes).toHaveLength(0);
  });
});

describe("mergeOverlayInto", () => {
  it("adds new nodes from overlay", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:Base", type: NodeType.Pipeline, name: "Base", metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:New", type: NodeType.Pipeline, name: "New", metadata: {} });

    mergeOverlayInto(base, overlay);

    expect(base.getNode("pipeline:Base")).toBeDefined();
    expect(base.getNode("pipeline:New")).toBeDefined();
    expect(base.stats().nodeCount).toBe(2);
  });

  it("replaces existing nodes and their edges", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-original", metadata: {} });
    base.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    base.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-replaced", metadata: {} });
    overlay.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    overlay.addEdge({ from: "pipeline:A", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    mergeOverlayInto(base, overlay);

    expect(base.getNode("pipeline:A")!.name).toBe("A-replaced");
    const outgoing = base.getOutgoing("pipeline:A");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].to).toBe("pipeline:C");
    expect(base.getNode("pipeline:C")).toBeDefined();
  });

  it("does not overwrite real nodes with stub nodes", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:Real", type: NodeType.Pipeline, name: "Real", metadata: {} });
    base.addNode({ id: "activity:Act1", type: NodeType.Activity, name: "Act1", metadata: {} });
    base.addNode({ id: "activity:Act2", type: NodeType.Activity, name: "Act2", metadata: {} });
    base.addNode({ id: "activity:Act3", type: NodeType.Activity, name: "Act3", metadata: {} });
    base.addEdge({ from: "pipeline:Real", to: "activity:Act1", type: EdgeType.Contains, metadata: {} });
    base.addEdge({ from: "pipeline:Real", to: "activity:Act2", type: EdgeType.Contains, metadata: {} });
    base.addEdge({ from: "pipeline:Real", to: "activity:Act3", type: EdgeType.Contains, metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:Real", type: NodeType.Pipeline, name: "Real-stub", metadata: { stub: true } });
    overlay.addNode({ id: "pipeline:New", type: NodeType.Pipeline, name: "New", metadata: {} });
    overlay.addEdge({ from: "pipeline:New", to: "pipeline:Real", type: EdgeType.Executes, metadata: {} });

    mergeOverlayInto(base, overlay);

    const realNode = base.getNode("pipeline:Real")!;
    expect(realNode.name).toBe("Real");
    expect(realNode.metadata.stub).toBeUndefined();

    const containsEdges = base.getOutgoing("pipeline:Real").filter((e) => e.type === EdgeType.Contains);
    expect(containsEdges).toHaveLength(3);

    expect(base.getNode("pipeline:New")).toBeDefined();
    const executesEdges = base.getOutgoing("pipeline:New").filter((e) => e.type === EdgeType.Executes);
    expect(executesEdges).toHaveLength(1);
    expect(executesEdges[0].to).toBe("pipeline:Real");
  });

  it("adds stub nodes when target does not have the node", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:Existing", type: NodeType.Pipeline, name: "Existing", metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:Unknown", type: NodeType.Pipeline, name: "Unknown", metadata: { stub: true } });

    mergeOverlayInto(base, overlay);

    const stubNode = base.getNode("pipeline:Unknown");
    expect(stubNode).toBeDefined();
    expect(stubNode!.metadata.stub).toBe(true);
  });
});
