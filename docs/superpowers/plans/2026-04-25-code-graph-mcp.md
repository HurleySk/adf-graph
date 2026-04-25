# Code Graph MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a C# MCP server that creates a queryable dependency graph from C# source code using Roslyn, starting with the boomerang- codebase.

**Architecture:** Hybrid approach — a prebuilt in-memory graph (nodes + edges + adjacency lists) handles structural queries and traversal, while a live Roslyn `Compilation` stays loaded for fine-grained data flow drill-down on demand. Four-pass builder (types → members → references → stubs) populates the graph. Eight MCP tools expose stats, callers, type description, impact analysis, path finding, implementation lookup, data flow, and search.

**Tech Stack:** .NET 9, Microsoft.CodeAnalysis.CSharp.Workspaces (Roslyn), ModelContextProtocol NuGet package (stdio transport), xUnit + FluentAssertions for tests.

---

## File Structure

```
C:\Users\shurley\source\repos\HurleySk\code-graph\
├── CodeGraph.sln
├── CLAUDE.md
├── .gitignore
├── src/
│   └── CodeGraph.Server/
│       ├── CodeGraph.Server.csproj
│       ├── Program.cs                    # MCP server entry point, tool registration
│       ├── Config.cs                     # Config loading (code-graph.json / env var)
│       ├── Graph/
│       │   ├── Model.cs                  # NodeType, EdgeType enums, GraphNode, GraphEdge, Graph class
│       │   ├── Builder.cs                # 4-pass Roslyn graph builder
│       │   ├── Staleness.cs              # Mtime-based rebuild tracking
│       │   └── GraphManager.cs           # Lazy build, staleness, compilation lifecycle
│       ├── Analysis/
│       │   └── DataFlowAnalyzer.cs       # Fine-grained Roslyn data flow (code_data_flow tool)
│       └── Tools/
│           ├── StatsTool.cs              # code_stats
│           ├── FindCallersTool.cs        # code_find_callers
│           ├── DescribeTypeTool.cs       # code_describe_type
│           ├── ImpactAnalysisTool.cs     # code_impact_analysis
│           ├── FindPathsTool.cs          # code_find_paths
│           ├── FindImplementationsTool.cs # code_find_implementations
│           ├── DataFlowTool.cs           # code_data_flow
│           └── SearchTool.cs             # code_search
└── tests/
    └── CodeGraph.Tests/
        ├── CodeGraph.Tests.csproj
        ├── Graph/
        │   ├── ModelTests.cs
        │   ├── BuilderTests.cs
        │   └── StalenessTests.cs
        ├── ConfigTests.cs
        └── Tools/
            ├── StatsToolTests.cs
            ├── FindCallersToolTests.cs
            ├── DescribeTypeToolTests.cs
            ├── ImpactAnalysisToolTests.cs
            ├── FindPathsToolTests.cs
            ├── FindImplementationsToolTests.cs
            └── SearchToolTests.cs
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\CodeGraph.sln`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\CodeGraph.Server.csproj`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\CodeGraph.Tests.csproj`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\.gitignore`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\CLAUDE.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p /c/Users/shurley/source/repos/HurleySk/code-graph/src/CodeGraph.Server/Graph
mkdir -p /c/Users/shurley/source/repos/HurleySk/code-graph/src/CodeGraph.Server/Analysis
mkdir -p /c/Users/shurley/source/repos/HurleySk/code-graph/src/CodeGraph.Server/Tools
mkdir -p /c/Users/shurley/source/repos/HurleySk/code-graph/tests/CodeGraph.Tests/Graph
mkdir -p /c/Users/shurley/source/repos/HurleySk/code-graph/tests/CodeGraph.Tests/Tools
```

- [ ] **Step 2: Create .gitignore**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\.gitignore`:

```
bin/
obj/
*.user
*.suo
.vs/
*.DotSettings.user
code-graph.json
```

- [ ] **Step 3: Create the server project file**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\CodeGraph.Server.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>CodeGraph.Server</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp.Workspaces" Version="4.*" />
    <PackageReference Include="Microsoft.CodeAnalysis.Workspaces.MSBuild" Version="4.*" />
    <PackageReference Include="Microsoft.Build.Locator" Version="1.*" />
    <PackageReference Include="ModelContextProtocol" Version="1.*" />
    <PackageReference Include="Microsoft.Extensions.Hosting" Version="9.*" />
  </ItemGroup>
</Project>
```

Note: `Microsoft.Build.Locator` is required for `MSBuildWorkspace` to find MSBuild — without it, `MSBuildWorkspace.Create()` throws. `Microsoft.CodeAnalysis.Workspaces.MSBuild` provides the `MSBuildWorkspace` class itself.

- [ ] **Step 4: Create the test project file**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\CodeGraph.Tests.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.*" />
    <PackageReference Include="xunit" Version="2.*" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.*" />
    <PackageReference Include="FluentAssertions" Version="8.*" />
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="4.*" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\CodeGraph.Server\CodeGraph.Server.csproj" />
  </ItemGroup>
</Project>
```

Note: Tests reference `Microsoft.CodeAnalysis.CSharp` (not Workspaces.MSBuild) because tests build in-memory `CSharpCompilation` instances directly rather than loading .sln files.

- [ ] **Step 5: Create the solution file**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet new sln --name CodeGraph
dotnet sln add src/CodeGraph.Server/CodeGraph.Server.csproj
dotnet sln add tests/CodeGraph.Tests/CodeGraph.Tests.csproj
```

- [ ] **Step 6: Create a minimal Program.cs**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Program.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddMcpServer()
    .WithStdioServerTransport();

builder.Logging.AddConsole(options =>
{
    options.LogToStandardErrorThreshold = LogLevel.Trace;
});

await builder.Build().RunAsync();
```

- [ ] **Step 7: Restore packages and verify build**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet restore
dotnet build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 8: Create CLAUDE.md**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\CLAUDE.md`:

```markdown
# code-graph

MCP server that builds a queryable dependency graph from C# source code using Roslyn.

## Build & Test

- Build: `dotnet build`
- Test: `dotnet test`
- Run: `dotnet run --project src/CodeGraph.Server`

## Architecture

- `src/CodeGraph.Server/Config.cs` — Config loader (code-graph.json / CODE_GRAPH_SOLUTION env var)
- `src/CodeGraph.Server/Graph/Model.cs` — Graph data structure (nodes, edges, adjacency lists)
- `src/CodeGraph.Server/Graph/Builder.cs` — 4-pass Roslyn graph builder (types → members → references → stubs)
- `src/CodeGraph.Server/Graph/Staleness.cs` — File mtime tracking, rebuild-if-stale
- `src/CodeGraph.Server/Graph/GraphManager.cs` — Lazy build, staleness, compilation lifecycle
- `src/CodeGraph.Server/Analysis/DataFlowAnalyzer.cs` — Fine-grained Roslyn data flow drill-down
- `src/CodeGraph.Server/Tools/` — One file per MCP tool
- `src/CodeGraph.Server/Program.cs` — MCP server entry point, tool registration

## Configuration

Create `code-graph.json` next to the executable:

    {
      "solution": "C:/path/to/Solution.sln"
    }

Or set `CODE_GRAPH_SOLUTION` env var pointing at a .sln file.
```

- [ ] **Step 9: Initialize git and commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git init
git add -A
git commit -m "chore: scaffold code-graph MCP server project"
```

---

## Task 2: Graph Model

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Model.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\ModelTests.cs`

- [ ] **Step 1: Write failing tests for Graph model**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\ModelTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using FluentAssertions;

namespace CodeGraph.Tests.Graph;

public class GraphTests
{
    [Fact]
    public void AddNode_And_GetNode_Roundtrips()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        var node = new GraphNode("class:Foo", NodeType.Class, "Foo", new Dictionary<string, object?>
        {
            ["filePath"] = "Foo.cs",
            ["line"] = 10
        });

        graph.AddNode(node);

        var retrieved = graph.GetNode("class:Foo");
        retrieved.Should().NotBeNull();
        retrieved!.Id.Should().Be("class:Foo");
        retrieved.Type.Should().Be(NodeType.Class);
        retrieved.Name.Should().Be("Foo");
    }

    [Fact]
    public void AddEdge_Creates_Forward_And_Reverse_Adjacency()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("class:A", NodeType.Class, "A"));
        graph.AddNode(new GraphNode("class:B", NodeType.Class, "B"));
        graph.AddEdge(new GraphEdge("class:A", "class:B", EdgeType.Inherits));

        graph.GetOutgoing("class:A").Should().ContainSingle(e => e.To == "class:B");
        graph.GetIncoming("class:B").Should().ContainSingle(e => e.From == "class:A");
    }

    [Fact]
    public void GetNodesByType_Filters_Correctly()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("class:A", NodeType.Class, "A"));
        graph.AddNode(new GraphNode("interface:I", NodeType.Interface, "I"));
        graph.AddNode(new GraphNode("class:B", NodeType.Class, "B"));

        var classes = graph.GetNodesByType(NodeType.Class);
        classes.Should().HaveCount(2);
        classes.Select(n => n.Id).Should().Contain(["class:A", "class:B"]);
    }

    [Fact]
    public void Stats_Returns_Correct_Counts()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("class:A", NodeType.Class, "A"));
        graph.AddNode(new GraphNode("method:A.Foo()", NodeType.Method, "Foo"));
        graph.AddEdge(new GraphEdge("method:A.Foo()", "class:A", EdgeType.ContainedIn));

        var stats = graph.Stats();
        stats.NodeCount.Should().Be(2);
        stats.EdgeCount.Should().Be(1);
        stats.NodesByType[NodeType.Class].Should().Be(1);
        stats.NodesByType[NodeType.Method].Should().Be(1);
        stats.EdgesByType[EdgeType.ContainedIn].Should().Be(1);
    }

    [Fact]
    public void TraverseDownstream_Returns_BFS_Order()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("method:A", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B", NodeType.Method, "B"));
        graph.AddNode(new GraphNode("method:C", NodeType.Method, "C"));
        graph.AddEdge(new GraphEdge("method:A", "method:B", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:B", "method:C", EdgeType.Calls));

        var results = graph.TraverseDownstream("method:A");
        results.Should().HaveCount(2);
        results[0].Node.Id.Should().Be("method:B");
        results[0].Depth.Should().Be(1);
        results[1].Node.Id.Should().Be("method:C");
        results[1].Depth.Should().Be(2);
    }

    [Fact]
    public void TraverseUpstream_Follows_Reverse_Edges()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("method:A", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B", NodeType.Method, "B"));
        graph.AddEdge(new GraphEdge("method:A", "method:B", EdgeType.Calls));

        var results = graph.TraverseUpstream("method:B");
        results.Should().ContainSingle(r => r.Node.Id == "method:A");
    }

    [Fact]
    public void FindPaths_Returns_All_Paths_Up_To_MaxDepth()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("method:A", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B", NodeType.Method, "B"));
        graph.AddNode(new GraphNode("method:C", NodeType.Method, "C"));
        // Two paths: A→B→C and A→C
        graph.AddEdge(new GraphEdge("method:A", "method:B", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:B", "method:C", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:A", "method:C", EdgeType.Calls));

        var paths = graph.FindPaths("method:A", "method:C");
        paths.Should().HaveCount(2);
    }

    [Fact]
    public void Clone_Creates_Independent_Copy()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddNode(new GraphNode("class:A", NodeType.Class, "A"));

        var clone = graph.Clone();
        clone.AddNode(new GraphNode("class:B", NodeType.Class, "B"));

        graph.GetNode("class:B").Should().BeNull();
        clone.GetNode("class:B").Should().NotBeNull();
    }

    [Fact]
    public void GetAllReferencedIds_Collects_Edge_Endpoints()
    {
        var graph = new CodeGraph.Server.Graph.Graph();
        graph.AddEdge(new GraphEdge("method:A", "method:B", EdgeType.Calls));

        var ids = graph.GetAllReferencedIds();
        ids.Should().Contain(["method:A", "method:B"]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test
```

Expected: Compilation errors — `Graph`, `GraphNode`, `GraphEdge`, `NodeType`, `EdgeType` do not exist.

- [ ] **Step 3: Implement the Graph model**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Model.cs`:

```csharp
namespace CodeGraph.Server.Graph;

public enum NodeType
{
    Namespace,
    Class,
    Interface,
    Enum,
    Method,
    Property,
    Field
}

public enum EdgeType
{
    ContainedIn,
    Calls,
    Implements,
    Inherits,
    UsesType,
    ReadsField,
    WritesField,
    DependsOn,
    OverridesMethod
}

public record GraphNode(
    string Id,
    NodeType Type,
    string Name,
    Dictionary<string, object?>? Metadata = null);

public record GraphEdge(
    string From,
    string To,
    EdgeType Type,
    Dictionary<string, object?>? Metadata = null);

public record TraversalResult(
    GraphNode Node,
    List<GraphEdge> Path,
    int Depth);

public record GraphStats(
    int NodeCount,
    int EdgeCount,
    Dictionary<NodeType, int> NodesByType,
    Dictionary<EdgeType, int> EdgesByType);

public class Graph
{
    private readonly Dictionary<string, GraphNode> _nodes = new();
    private readonly Dictionary<string, List<GraphEdge>> _outgoing = new();
    private readonly Dictionary<string, List<GraphEdge>> _incoming = new();

    public void AddNode(GraphNode node)
    {
        _nodes[node.Id] = node;
        _outgoing.TryAdd(node.Id, []);
        _incoming.TryAdd(node.Id, []);
    }

    public GraphNode? GetNode(string id) =>
        _nodes.GetValueOrDefault(id);

    public void AddEdge(GraphEdge edge)
    {
        if (!_outgoing.ContainsKey(edge.From))
            _outgoing[edge.From] = [];
        if (!_incoming.ContainsKey(edge.To))
            _incoming[edge.To] = [];
        _outgoing[edge.From].Add(edge);
        _incoming[edge.To].Add(edge);
    }

    public List<GraphEdge> GetOutgoing(string id) =>
        _outgoing.GetValueOrDefault(id, []);

    public List<GraphEdge> GetIncoming(string id) =>
        _incoming.GetValueOrDefault(id, []);

    public List<GraphNode> GetNodesByType(NodeType type) =>
        _nodes.Values.Where(n => n.Type == type).ToList();

    public GraphStats Stats()
    {
        var nodesByType = new Dictionary<NodeType, int>();
        foreach (var node in _nodes.Values)
            nodesByType[node.Type] = nodesByType.GetValueOrDefault(node.Type) + 1;

        var edgesByType = new Dictionary<EdgeType, int>();
        var edgeCount = 0;
        foreach (var edges in _outgoing.Values)
        {
            foreach (var edge in edges)
            {
                edgesByType[edge.Type] = edgesByType.GetValueOrDefault(edge.Type) + 1;
                edgeCount++;
            }
        }

        return new GraphStats(
            _nodes.Count,
            edgeCount,
            nodesByType,
            edgesByType);
    }

    public List<TraversalResult> TraverseDownstream(string startId) =>
        Bfs(startId, Direction.Downstream);

    public List<TraversalResult> TraverseUpstream(string startId) =>
        Bfs(startId, Direction.Upstream);

    public List<List<GraphEdge>> FindPaths(string fromId, string toId, int maxDepth = 20)
    {
        var results = new List<List<GraphEdge>>();
        var visited = new HashSet<string> { fromId };
        var path = new List<GraphEdge>();

        void Dfs(string current)
        {
            if (current == toId && path.Count > 0)
            {
                results.Add(new List<GraphEdge>(path));
                return;
            }
            if (path.Count >= maxDepth) return;

            foreach (var edge in GetOutgoing(current))
            {
                if (visited.Contains(edge.To)) continue;
                visited.Add(edge.To);
                path.Add(edge);
                Dfs(edge.To);
                path.RemoveAt(path.Count - 1);
                visited.Remove(edge.To);
            }
        }

        Dfs(fromId);
        return results;
    }

    public List<GraphNode> AllNodes() => [.. _nodes.Values];

    public Graph Clone()
    {
        var copy = new Graph();
        foreach (var node in _nodes.Values)
            copy.AddNode(node with { Metadata = node.Metadata is null ? null : new(node.Metadata) });
        foreach (var edges in _outgoing.Values)
            foreach (var edge in edges)
                copy.AddEdge(edge with { Metadata = edge.Metadata is null ? null : new(edge.Metadata) });
        return copy;
    }

    public HashSet<string> GetAllReferencedIds()
    {
        var ids = new HashSet<string>();
        foreach (var edges in _outgoing.Values)
            foreach (var edge in edges)
            {
                ids.Add(edge.From);
                ids.Add(edge.To);
            }
        return ids;
    }

    private enum Direction { Downstream, Upstream }

    private List<TraversalResult> Bfs(string startId, Direction direction)
    {
        var results = new List<TraversalResult>();
        var visited = new HashSet<string> { startId };
        var queue = new Queue<(string Id, List<GraphEdge> Path, int Depth)>();
        queue.Enqueue((startId, [], 0));

        while (queue.Count > 0)
        {
            var (id, currentPath, depth) = queue.Dequeue();
            var edges = direction == Direction.Downstream
                ? GetOutgoing(id)
                : GetIncoming(id);

            foreach (var edge in edges)
            {
                var nextId = direction == Direction.Downstream ? edge.To : edge.From;
                if (visited.Contains(nextId)) continue;
                visited.Add(nextId);

                var nextPath = new List<GraphEdge>(currentPath) { edge };
                var node = GetNode(nextId);
                if (node is not null)
                    results.Add(new TraversalResult(node, nextPath, depth + 1));
                queue.Enqueue((nextId, nextPath, depth + 1));
            }
        }

        return results;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~ModelTests"
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Graph/Model.cs tests/CodeGraph.Tests/Graph/ModelTests.cs
git commit -m "feat: add Graph model with nodes, edges, traversal, and path finding"
```

---

## Task 3: Staleness Checker

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Staleness.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\StalenessTests.cs`

- [ ] **Step 1: Write failing tests**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\StalenessTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using FluentAssertions;

namespace CodeGraph.Tests.Graph;

public class StalenessTests : IDisposable
{
    private readonly string _tempDir;

    public StalenessTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "codegraph-test-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    [Fact]
    public void IsStale_Returns_True_When_Never_Built()
    {
        var checker = new StalenessChecker(_tempDir);
        checker.IsStale().Should().BeTrue();
    }

    [Fact]
    public void IsStale_Returns_False_After_MarkBuilt()
    {
        File.WriteAllText(Path.Combine(_tempDir, "Foo.cs"), "class Foo {}");
        var checker = new StalenessChecker(_tempDir);

        checker.MarkBuilt();

        checker.IsStale().Should().BeFalse();
    }

    [Fact]
    public void IsStale_Returns_True_When_File_Modified_After_Build()
    {
        var filePath = Path.Combine(_tempDir, "Foo.cs");
        File.WriteAllText(filePath, "class Foo {}");

        var checker = new StalenessChecker(_tempDir);
        checker.MarkBuilt();

        // Advance mtime
        File.SetLastWriteTimeUtc(filePath, DateTime.UtcNow.AddSeconds(2));

        checker.IsStale().Should().BeTrue();
    }

    [Fact]
    public void IsStale_Returns_True_When_New_File_Added_After_Build()
    {
        File.WriteAllText(Path.Combine(_tempDir, "A.cs"), "class A {}");

        var checker = new StalenessChecker(_tempDir);
        checker.MarkBuilt();

        // New file with future mtime
        var newFile = Path.Combine(_tempDir, "B.cs");
        File.WriteAllText(newFile, "class B {}");
        File.SetLastWriteTimeUtc(newFile, DateTime.UtcNow.AddSeconds(2));

        checker.IsStale().Should().BeTrue();
    }

    [Fact]
    public void LastBuildTime_Returns_Null_When_Never_Built()
    {
        var checker = new StalenessChecker(_tempDir);
        checker.LastBuildTime().Should().BeNull();
    }

    [Fact]
    public void LastBuildTime_Returns_Date_After_MarkBuilt()
    {
        var checker = new StalenessChecker(_tempDir);
        checker.MarkBuilt();
        checker.LastBuildTime().Should().NotBeNull();
        checker.LastBuildTime()!.Value.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void Watches_Only_CSharp_Files_In_Subdirectories()
    {
        var subDir = Path.Combine(_tempDir, "sub");
        Directory.CreateDirectory(subDir);
        File.WriteAllText(Path.Combine(subDir, "Deep.cs"), "class Deep {}");

        var checker = new StalenessChecker(_tempDir);
        checker.MarkBuilt();

        File.SetLastWriteTimeUtc(Path.Combine(subDir, "Deep.cs"), DateTime.UtcNow.AddSeconds(2));

        checker.IsStale().Should().BeTrue();
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~StalenessTests"
```

Expected: Compilation error — `StalenessChecker` does not exist.

- [ ] **Step 3: Implement StalenessChecker**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Staleness.cs`:

```csharp
namespace CodeGraph.Server.Graph;

public class StalenessChecker
{
    private readonly string _rootPath;
    private long? _builtAt;
    private long? _builtMaxMtime;

    public StalenessChecker(string rootPath)
    {
        _rootPath = rootPath;
    }

    public bool IsStale()
    {
        if (_builtAt is null || _builtMaxMtime is null) return true;
        if (!Directory.Exists(_rootPath)) return true;

        var currentMax = CurrentMaxMtime(_rootPath);
        return currentMax > _builtMaxMtime;
    }

    public void MarkBuilt()
    {
        _builtMaxMtime = CurrentMaxMtime(_rootPath);
        _builtAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    public DateTime? LastBuildTime() =>
        _builtAt is null
            ? null
            : DateTimeOffset.FromUnixTimeMilliseconds(_builtAt.Value).UtcDateTime;

    public void Invalidate()
    {
        _builtAt = null;
        _builtMaxMtime = null;
    }

    private static long CurrentMaxMtime(string dir)
    {
        if (!Directory.Exists(dir)) return 0;

        long max = 0;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories))
            {
                try
                {
                    var mtime = File.GetLastWriteTimeUtc(file).Ticks;
                    if (mtime > max) max = mtime;
                }
                catch { }
            }
        }
        catch { }

        return max;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~StalenessTests"
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Graph/Staleness.cs tests/CodeGraph.Tests/Graph/StalenessTests.cs
git commit -m "feat: add StalenessChecker with mtime-based rebuild tracking"
```

---

## Task 4: Config Loader

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Config.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\ConfigTests.cs`

- [ ] **Step 1: Write failing tests**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\ConfigTests.cs`:

```csharp
using CodeGraph.Server;
using FluentAssertions;

namespace CodeGraph.Tests;

public class ConfigTests : IDisposable
{
    private readonly string _tempDir;
    private readonly string? _originalEnvVar;

    public ConfigTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "codegraph-config-test-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_tempDir);
        _originalEnvVar = Environment.GetEnvironmentVariable("CODE_GRAPH_SOLUTION");
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("CODE_GRAPH_SOLUTION", _originalEnvVar);
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    [Fact]
    public void LoadConfig_From_Json_File()
    {
        var configPath = Path.Combine(_tempDir, "code-graph.json");
        File.WriteAllText(configPath, """{"solution": "C:/test/My.sln"}""");

        var config = ConfigLoader.LoadFromFile(configPath);

        config.Solution.Should().Be("C:/test/My.sln");
    }

    [Fact]
    public void LoadConfig_From_EnvVar()
    {
        Environment.SetEnvironmentVariable("CODE_GRAPH_SOLUTION", "C:/env/Test.sln");

        var config = ConfigLoader.LoadFromEnvironment();

        config.Should().NotBeNull();
        config!.Solution.Should().Be("C:/env/Test.sln");
    }

    [Fact]
    public void LoadConfig_EnvVar_Returns_Null_When_Not_Set()
    {
        Environment.SetEnvironmentVariable("CODE_GRAPH_SOLUTION", null);

        var config = ConfigLoader.LoadFromEnvironment();

        config.Should().BeNull();
    }

    [Fact]
    public void LoadConfig_Throws_For_Missing_Solution_Key()
    {
        var configPath = Path.Combine(_tempDir, "code-graph.json");
        File.WriteAllText(configPath, """{"other": "value"}""");

        var act = () => ConfigLoader.LoadFromFile(configPath);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*solution*");
    }

    [Fact]
    public void LoadConfig_Throws_For_Missing_File()
    {
        var act = () => ConfigLoader.LoadFromFile(Path.Combine(_tempDir, "missing.json"));

        act.Should().Throw<FileNotFoundException>();
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~ConfigTests"
```

Expected: Compilation error — `ConfigLoader` does not exist.

- [ ] **Step 3: Implement ConfigLoader**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Config.cs`:

```csharp
using System.Text.Json;

namespace CodeGraph.Server;

public record CodeGraphConfig(string Solution);

public static class ConfigLoader
{
    public static CodeGraphConfig LoadFromFile(string filePath)
    {
        if (!File.Exists(filePath))
            throw new FileNotFoundException($"code-graph: config file not found: {filePath}", filePath);

        var json = File.ReadAllText(filePath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("solution", out var solutionElement) ||
            solutionElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(solutionElement.GetString()))
        {
            throw new InvalidOperationException(
                $"code-graph: config '{filePath}' must have a non-empty \"solution\" string");
        }

        return new CodeGraphConfig(solutionElement.GetString()!);
    }

    public static CodeGraphConfig? LoadFromEnvironment()
    {
        var solutionPath = Environment.GetEnvironmentVariable("CODE_GRAPH_SOLUTION");
        if (string.IsNullOrWhiteSpace(solutionPath))
            return null;
        return new CodeGraphConfig(solutionPath);
    }

    public static CodeGraphConfig Load(string? sidecarDir = null)
    {
        // Priority 1: code-graph.json next to executable
        if (sidecarDir is not null)
        {
            var sidecarPath = Path.Combine(sidecarDir, "code-graph.json");
            if (File.Exists(sidecarPath))
                return LoadFromFile(sidecarPath);
        }

        // Priority 2: CODE_GRAPH_SOLUTION env var
        var envConfig = LoadFromEnvironment();
        if (envConfig is not null)
            return envConfig;

        throw new InvalidOperationException(
            "code-graph: no configuration found. " +
            "Place code-graph.json next to the server, or set CODE_GRAPH_SOLUTION to a .sln path.");
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~ConfigTests"
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Config.cs tests/CodeGraph.Tests/ConfigTests.cs
git commit -m "feat: add config loader with JSON file and env var support"
```

---

## Task 5: Graph Builder (4-Pass Roslyn Analysis)

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Builder.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\BuilderTests.cs`

This is the largest task. Tests use in-memory `CSharpCompilation` (no .sln needed).

- [ ] **Step 1: Write failing tests for all 4 passes**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Graph\BuilderTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using FluentAssertions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace CodeGraph.Tests.Graph;

public class BuilderTests
{
    private static Compilation CreateCompilation(string source, string assemblyName = "TestAssembly")
    {
        var syntaxTree = CSharpSyntaxTree.ParseText(source);
        var references = new[]
        {
            MetadataReference.CreateFromFile(typeof(object).Assembly.Location),
            MetadataReference.CreateFromFile(typeof(Console).Assembly.Location),
            MetadataReference.CreateFromFile(
                Path.Combine(Path.GetDirectoryName(typeof(object).Assembly.Location)!,
                "System.Runtime.dll"))
        };
        return CSharpCompilation.Create(assemblyName, [syntaxTree], references,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
    }

    // ── Pass 1: Types ──

    [Fact]
    public void Pass1_Creates_Class_Nodes()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo { }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetNode("class:MyApp.Foo").Should().NotBeNull();
        result.Graph.GetNode("class:MyApp.Foo")!.Type.Should().Be(NodeType.Class);
    }

    [Fact]
    public void Pass1_Creates_Interface_Nodes()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public interface IService { }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetNode("interface:MyApp.IService").Should().NotBeNull();
    }

    [Fact]
    public void Pass1_Creates_Enum_Nodes()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public enum Color { Red, Green, Blue }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetNode("enum:MyApp.Color").Should().NotBeNull();
    }

    [Fact]
    public void Pass1_Creates_Inherits_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Base { }
                public class Derived : Base { }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetOutgoing("class:MyApp.Derived")
            .Should().Contain(e => e.Type == EdgeType.Inherits && e.To == "class:MyApp.Base");
    }

    [Fact]
    public void Pass1_Creates_Implements_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public interface IService { }
                public class MyService : IService { }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetOutgoing("class:MyApp.MyService")
            .Should().Contain(e => e.Type == EdgeType.Implements && e.To == "interface:MyApp.IService");
    }

    // ── Pass 2: Members ──

    [Fact]
    public void Pass2_Creates_Method_Nodes_With_ContainedIn_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    public void DoWork() { }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var methodNode = result.Graph.AllNodes()
            .FirstOrDefault(n => n.Type == NodeType.Method && n.Name == "DoWork");
        methodNode.Should().NotBeNull();

        result.Graph.GetOutgoing(methodNode!.Id)
            .Should().Contain(e => e.Type == EdgeType.ContainedIn && e.To == "class:MyApp.Foo");
    }

    [Fact]
    public void Pass2_Method_Id_Includes_Parameters_For_Overloads()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    public void Do(int x) { }
                    public void Do(string s) { }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var methods = result.Graph.AllNodes()
            .Where(n => n.Type == NodeType.Method && n.Name == "Do")
            .ToList();
        methods.Should().HaveCount(2);
        methods.Select(m => m.Id).Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void Pass2_Creates_Property_Nodes()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    public string Name { get; set; }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var propNode = result.Graph.AllNodes()
            .FirstOrDefault(n => n.Type == NodeType.Property && n.Name == "Name");
        propNode.Should().NotBeNull();
    }

    [Fact]
    public void Pass2_Creates_Field_Nodes()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    private int _count;
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var fieldNode = result.Graph.AllNodes()
            .FirstOrDefault(n => n.Type == NodeType.Field && n.Name == "_count");
        fieldNode.Should().NotBeNull();
    }

    [Fact]
    public void Pass2_Creates_OverridesMethod_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Base
                {
                    public virtual void Run() { }
                }
                public class Derived : Base
                {
                    public override void Run() { }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var derivedRun = result.Graph.AllNodes()
            .First(n => n.Type == NodeType.Method && n.Name == "Run" && n.Id.Contains("Derived"));

        result.Graph.GetOutgoing(derivedRun.Id)
            .Should().Contain(e => e.Type == EdgeType.OverridesMethod);
    }

    // ── Pass 3: References ──

    [Fact]
    public void Pass3_Creates_Calls_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    public void A() { B(); }
                    public void B() { }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var methodA = result.Graph.AllNodes()
            .First(n => n.Type == NodeType.Method && n.Name == "A");

        result.Graph.GetOutgoing(methodA.Id)
            .Should().Contain(e => e.Type == EdgeType.Calls);
    }

    [Fact]
    public void Pass3_Creates_ReadsField_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    private int _x;
                    public int Get() { return _x; }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var getMethod = result.Graph.AllNodes()
            .First(n => n.Type == NodeType.Method && n.Name == "Get");

        result.Graph.GetOutgoing(getMethod.Id)
            .Should().Contain(e => e.Type == EdgeType.ReadsField);
    }

    [Fact]
    public void Pass3_Creates_WritesField_Edges()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    private int _x;
                    public void Set(int v) { _x = v; }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var setMethod = result.Graph.AllNodes()
            .First(n => n.Type == NodeType.Method && n.Name == "Set");

        result.Graph.GetOutgoing(setMethod.Id)
            .Should().Contain(e => e.Type == EdgeType.WritesField);
    }

    [Fact]
    public void Pass3_Creates_DependsOn_Edges_For_Constructor_Injection()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Dep { }
                public class Consumer
                {
                    private readonly Dep _dep;
                    public Consumer(Dep dep) { _dep = dep; }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        result.Graph.GetOutgoing("class:MyApp.Consumer")
            .Should().Contain(e => e.Type == EdgeType.DependsOn && e.To == "class:MyApp.Dep");
    }

    // ── Pass 4: Stubs ──

    [Fact]
    public void Pass4_Creates_Stub_Nodes_For_External_References()
    {
        var compilation = CreateCompilation("""
            namespace MyApp
            {
                public class Foo
                {
                    public void Run() { System.Console.WriteLine("hi"); }
                }
            }
            """);

        var result = GraphBuilder.Build(compilation);

        var stubs = result.Graph.AllNodes()
            .Where(n => n.Metadata?.GetValueOrDefault("stub") is true)
            .ToList();
        stubs.Should().NotBeEmpty();
    }

    // ── BuildResult ──

    [Fact]
    public void Build_Returns_BuildTimeMs()
    {
        var compilation = CreateCompilation("namespace MyApp { public class Empty { } }");

        var result = GraphBuilder.Build(compilation);

        result.BuildTimeMs.Should().BeGreaterOrEqualTo(0);
    }

    [Fact]
    public void Build_Returns_Warnings_List()
    {
        var compilation = CreateCompilation("namespace MyApp { public class Empty { } }");

        var result = GraphBuilder.Build(compilation);

        result.Warnings.Should().NotBeNull();
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~BuilderTests"
```

Expected: Compilation error — `GraphBuilder` does not exist.

- [ ] **Step 3: Implement GraphBuilder**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\Builder.cs`:

```csharp
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CodeGraph.Server.Graph;

public record BuildResult(
    Graph Graph,
    List<string> Warnings,
    long BuildTimeMs);

public static class GraphBuilder
{
    public static BuildResult Build(Compilation compilation)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var graph = new Graph();
        var warnings = new List<string>();

        foreach (var tree in compilation.SyntaxTrees)
        {
            var semanticModel = compilation.GetSemanticModel(tree);
            var root = tree.GetRoot();

            // Pass 1: Types
            PassOneTypes(root, semanticModel, graph, warnings);

            // Pass 2: Members
            PassTwoMembers(root, semanticModel, graph, warnings);

            // Pass 3: References
            PassThreeReferences(root, semanticModel, graph, warnings);
        }

        // Pass 4: Stubs
        PassFourStubs(graph);

        sw.Stop();
        return new BuildResult(graph, warnings, sw.ElapsedMilliseconds);
    }

    private static void PassOneTypes(
        SyntaxNode root, SemanticModel model, Graph graph, List<string> warnings)
    {
        foreach (var typeDecl in root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            var symbol = model.GetDeclaredSymbol(typeDecl);
            if (symbol is not INamedTypeSymbol typeSymbol) continue;

            var (nodeType, prefix) = typeSymbol.TypeKind switch
            {
                TypeKind.Class => (NodeType.Class, "class"),
                TypeKind.Struct => (NodeType.Class, "class"),
                TypeKind.Interface => (NodeType.Interface, "interface"),
                TypeKind.Enum => (NodeType.Enum, "enum"),
                _ => ((NodeType?)null, (string?)null)
            };

            if (nodeType is null || prefix is null) continue;

            var fqn = GetFullyQualifiedName(typeSymbol);
            var nodeId = $"{prefix}:{fqn}";
            var location = typeDecl.GetLocation();
            var lineSpan = location.GetLineSpan();

            var metadata = new Dictionary<string, object?>
            {
                ["filePath"] = lineSpan.Path,
                ["line"] = lineSpan.StartLinePosition.Line + 1,
                ["accessibility"] = typeSymbol.DeclaredAccessibility.ToString(),
                ["isStatic"] = typeSymbol.IsStatic,
                ["isAbstract"] = typeSymbol.IsAbstract,
                ["isSealed"] = typeSymbol.IsSealed
            };

            graph.AddNode(new GraphNode(nodeId, nodeType.Value, typeSymbol.Name, metadata));

            // Inherits edge (base class)
            if (typeSymbol.BaseType is not null &&
                typeSymbol.BaseType.SpecialType == SpecialType.None)
            {
                var baseId = $"{GetPrefix(typeSymbol.BaseType)}:{GetFullyQualifiedName(typeSymbol.BaseType)}";
                graph.AddEdge(new GraphEdge(nodeId, baseId, EdgeType.Inherits));
            }

            // Implements edges (interfaces)
            foreach (var iface in typeSymbol.Interfaces)
            {
                var ifaceId = $"interface:{GetFullyQualifiedName(iface)}";
                graph.AddEdge(new GraphEdge(nodeId, ifaceId, EdgeType.Implements));
            }
        }
    }

    private static void PassTwoMembers(
        SyntaxNode root, SemanticModel model, Graph graph, List<string> warnings)
    {
        foreach (var typeDecl in root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            var typeSymbol = model.GetDeclaredSymbol(typeDecl) as INamedTypeSymbol;
            if (typeSymbol is null) continue;

            var typeFqn = GetFullyQualifiedName(typeSymbol);
            var typePrefix = GetPrefix(typeSymbol);
            var typeId = $"{typePrefix}:{typeFqn}";

            if (graph.GetNode(typeId) is null) continue;

            foreach (var member in typeSymbol.GetMembers())
            {
                if (member.IsImplicitlyDeclared) continue;

                switch (member)
                {
                    case IMethodSymbol method when method.MethodKind is
                        MethodKind.Ordinary or MethodKind.Constructor:
                    {
                        var methodId = GetMethodId(method);
                        var lineSpan = member.Locations.FirstOrDefault()?.GetLineSpan();
                        var metadata = new Dictionary<string, object?>
                        {
                            ["filePath"] = lineSpan?.Path,
                            ["line"] = (lineSpan?.StartLinePosition.Line ?? 0) + 1,
                            ["accessibility"] = method.DeclaredAccessibility.ToString(),
                            ["isStatic"] = method.IsStatic,
                            ["isVirtual"] = method.IsVirtual,
                            ["isAbstract"] = method.IsAbstract,
                            ["isOverride"] = method.IsOverride,
                            ["returnType"] = method.ReturnType.ToDisplayString(),
                            ["parameters"] = string.Join(", ",
                                method.Parameters.Select(p => $"{p.Type.ToDisplayString()} {p.Name}"))
                        };

                        graph.AddNode(new GraphNode(methodId, NodeType.Method, method.Name, metadata));
                        graph.AddEdge(new GraphEdge(methodId, typeId, EdgeType.ContainedIn));

                        // Override edge
                        if (method.IsOverride && method.OverriddenMethod is not null)
                        {
                            var overriddenId = GetMethodId(method.OverriddenMethod);
                            graph.AddEdge(new GraphEdge(methodId, overriddenId, EdgeType.OverridesMethod));
                        }
                        break;
                    }

                    case IPropertySymbol prop:
                    {
                        var propId = $"property:{typeFqn}.{prop.Name}";
                        var lineSpan = member.Locations.FirstOrDefault()?.GetLineSpan();
                        graph.AddNode(new GraphNode(propId, NodeType.Property, prop.Name,
                            new Dictionary<string, object?>
                            {
                                ["filePath"] = lineSpan?.Path,
                                ["line"] = (lineSpan?.StartLinePosition.Line ?? 0) + 1,
                                ["accessibility"] = prop.DeclaredAccessibility.ToString(),
                                ["type"] = prop.Type.ToDisplayString()
                            }));
                        graph.AddEdge(new GraphEdge(propId, typeId, EdgeType.ContainedIn));
                        break;
                    }

                    case IFieldSymbol field:
                    {
                        var fieldId = $"field:{typeFqn}.{field.Name}";
                        var lineSpan = member.Locations.FirstOrDefault()?.GetLineSpan();
                        graph.AddNode(new GraphNode(fieldId, NodeType.Field, field.Name,
                            new Dictionary<string, object?>
                            {
                                ["filePath"] = lineSpan?.Path,
                                ["line"] = (lineSpan?.StartLinePosition.Line ?? 0) + 1,
                                ["accessibility"] = field.DeclaredAccessibility.ToString(),
                                ["type"] = field.Type.ToDisplayString(),
                                ["isReadOnly"] = field.IsReadOnly
                            }));
                        graph.AddEdge(new GraphEdge(fieldId, typeId, EdgeType.ContainedIn));
                        break;
                    }
                }
            }
        }
    }

    private static void PassThreeReferences(
        SyntaxNode root, SemanticModel model, Graph graph, List<string> warnings)
    {
        foreach (var methodDecl in root.DescendantNodes().OfType<MethodDeclarationSyntax>())
        {
            var methodSymbol = model.GetDeclaredSymbol(methodDecl);
            if (methodSymbol is null) continue;

            var methodId = GetMethodId(methodSymbol);
            if (graph.GetNode(methodId) is null) continue;

            if (methodDecl.Body is null && methodDecl.ExpressionBody is null) continue;
            var bodyNode = (SyntaxNode?)methodDecl.Body ?? methodDecl.ExpressionBody;

            // Calls edges
            foreach (var invocation in bodyNode!.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                var symbolInfo = model.GetSymbolInfo(invocation);
                if (symbolInfo.Symbol is IMethodSymbol calledMethod &&
                    calledMethod.MethodKind is MethodKind.Ordinary or MethodKind.Constructor)
                {
                    var targetId = GetMethodId(calledMethod);
                    graph.AddEdge(new GraphEdge(methodId, targetId, EdgeType.Calls));
                }
            }

            // Field/property access
            foreach (var identifier in bodyNode!.DescendantNodes().OfType<IdentifierNameSyntax>())
            {
                var symbolInfo = model.GetSymbolInfo(identifier);
                switch (symbolInfo.Symbol)
                {
                    case IFieldSymbol field when !field.IsImplicitlyDeclared:
                    {
                        var fieldId = $"field:{GetFullyQualifiedName(field.ContainingType)}.{field.Name}";
                        var isWrite = IsWriteAccess(identifier);
                        graph.AddEdge(new GraphEdge(methodId, fieldId,
                            isWrite ? EdgeType.WritesField : EdgeType.ReadsField));
                        break;
                    }
                    case IPropertySymbol prop:
                    {
                        var propId = $"property:{GetFullyQualifiedName(prop.ContainingType)}.{prop.Name}";
                        var isWrite = IsWriteAccess(identifier);
                        graph.AddEdge(new GraphEdge(methodId, propId,
                            isWrite ? EdgeType.WritesField : EdgeType.ReadsField));
                        break;
                    }
                }
            }

            // UsesType edges (parameter types and return type)
            foreach (var param in methodSymbol.Parameters)
            {
                var paramType = GetNamedType(param.Type);
                if (paramType is not null && paramType.SpecialType == SpecialType.None)
                {
                    var typeId = $"{GetPrefix(paramType)}:{GetFullyQualifiedName(paramType)}";
                    graph.AddEdge(new GraphEdge(methodId, typeId, EdgeType.UsesType));
                }
            }
        }

        // Constructor injection → DependsOn edges
        foreach (var ctorDecl in root.DescendantNodes().OfType<ConstructorDeclarationSyntax>())
        {
            var ctorSymbol = model.GetDeclaredSymbol(ctorDecl);
            if (ctorSymbol is null) continue;

            var containingType = ctorSymbol.ContainingType;
            var typeId = $"{GetPrefix(containingType)}:{GetFullyQualifiedName(containingType)}";

            foreach (var param in ctorSymbol.Parameters)
            {
                var paramType = GetNamedType(param.Type);
                if (paramType is not null &&
                    paramType.SpecialType == SpecialType.None &&
                    paramType.TypeKind is TypeKind.Class or TypeKind.Interface)
                {
                    var depId = $"{GetPrefix(paramType)}:{GetFullyQualifiedName(paramType)}";
                    graph.AddEdge(new GraphEdge(typeId, depId, EdgeType.DependsOn));
                }
            }
        }
    }

    private static void PassFourStubs(Graph graph)
    {
        var referencedIds = graph.GetAllReferencedIds();
        foreach (var id in referencedIds)
        {
            if (graph.GetNode(id) is not null) continue;

            var colonIdx = id.IndexOf(':');
            if (colonIdx < 0) continue;

            var prefix = id[..colonIdx];
            var name = id[(colonIdx + 1)..];

            var nodeType = prefix switch
            {
                "class" => NodeType.Class,
                "interface" => NodeType.Interface,
                "enum" => NodeType.Enum,
                "method" => NodeType.Method,
                "property" => NodeType.Property,
                "field" => NodeType.Field,
                "namespace" => NodeType.Namespace,
                _ => (NodeType?)null
            };

            if (nodeType is null) continue;

            var lastDot = name.LastIndexOf('.');
            var shortName = lastDot >= 0 ? name[(lastDot + 1)..] : name;
            // For method stubs, strip the parameter list from the short name
            var parenIdx = shortName.IndexOf('(');
            if (parenIdx >= 0) shortName = shortName[..parenIdx];

            graph.AddNode(new GraphNode(id, nodeType.Value, shortName,
                new Dictionary<string, object?> { ["stub"] = true }));
        }
    }

    private static string GetFullyQualifiedName(INamedTypeSymbol symbol)
    {
        var ns = symbol.ContainingNamespace;
        if (ns is null || ns.IsGlobalNamespace)
            return symbol.Name;
        return $"{ns.ToDisplayString()}.{symbol.Name}";
    }

    private static string GetPrefix(INamedTypeSymbol symbol) =>
        symbol.TypeKind switch
        {
            TypeKind.Interface => "interface",
            TypeKind.Enum => "enum",
            _ => "class"
        };

    private static string GetMethodId(IMethodSymbol method)
    {
        var typeFqn = GetFullyQualifiedName(method.ContainingType);
        var paramList = string.Join(",",
            method.Parameters.Select(p => p.Type.ToDisplayString(
                SymbolDisplayFormat.MinimallyQualifiedFormat)));
        var name = method.MethodKind == MethodKind.Constructor ? ".ctor" : method.Name;
        return $"method:{typeFqn}.{name}({paramList})";
    }

    private static INamedTypeSymbol? GetNamedType(ITypeSymbol type) =>
        type is INamedTypeSymbol named ? named : null;

    private static bool IsWriteAccess(IdentifierNameSyntax identifier)
    {
        var parent = identifier.Parent;
        if (parent is AssignmentExpressionSyntax assignment && assignment.Left == identifier)
            return true;
        if (parent is PrefixUnaryExpressionSyntax prefix &&
            prefix.Operand == identifier &&
            (prefix.IsKind(SyntaxKind.PreIncrementExpression) ||
             prefix.IsKind(SyntaxKind.PreDecrementExpression)))
            return true;
        if (parent is PostfixUnaryExpressionSyntax postfix &&
            postfix.Operand == identifier &&
            (postfix.IsKind(SyntaxKind.PostIncrementExpression) ||
             postfix.IsKind(SyntaxKind.PostDecrementExpression)))
            return true;
        return false;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~BuilderTests"
```

Expected: All 16 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Graph/Builder.cs tests/CodeGraph.Tests/Graph/BuilderTests.cs
git commit -m "feat: add 4-pass Roslyn graph builder (types, members, references, stubs)"
```

---

## Task 6: GraphManager

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\GraphManager.cs`

The GraphManager orchestrates lazy building, staleness checking, and compilation lifecycle. This is wired to the MCP tools — they call `manager.EnsureGraph()` and get back the Graph. It also holds the live `Compilation` for data flow drill-down.

- [ ] **Step 1: Implement GraphManager**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Graph\GraphManager.cs`:

```csharp
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.MSBuild;

namespace CodeGraph.Server.Graph;

public class GraphManager : IDisposable
{
    private readonly string _solutionPath;
    private readonly StalenessChecker _staleness;
    private BuildResult? _buildResult;
    private Compilation? _compilation;
    private MSBuildWorkspace? _workspace;
    private static bool _msbuildRegistered;

    public GraphManager(string solutionPath)
    {
        _solutionPath = solutionPath;
        var solutionDir = Path.GetDirectoryName(Path.GetFullPath(solutionPath))!;
        _staleness = new StalenessChecker(solutionDir);
    }

    public BuildResult EnsureGraph()
    {
        if (_buildResult is not null && !_staleness.IsStale())
            return _buildResult;

        RebuildGraph();
        return _buildResult!;
    }

    public Compilation EnsureCompilation()
    {
        EnsureGraph();
        return _compilation!;
    }

    public bool IsStale => _staleness.IsStale();

    public DateTime? LastBuildTime => _staleness.LastBuildTime();

    private void RebuildGraph()
    {
        _workspace?.Dispose();

        if (!_msbuildRegistered)
        {
            MSBuildLocator.RegisterDefaults();
            _msbuildRegistered = true;
        }

        _workspace = MSBuildWorkspace.Create();
        var solution = _workspace.OpenSolutionAsync(_solutionPath).GetAwaiter().GetResult();

        // Merge compilations from all projects
        Compilation? mergedCompilation = null;
        foreach (var project in solution.Projects)
        {
            var compilation = project.GetCompilationAsync().GetAwaiter().GetResult();
            if (compilation is null) continue;

            if (mergedCompilation is null)
            {
                mergedCompilation = compilation;
            }
            else
            {
                // Add syntax trees from subsequent projects into the first compilation
                foreach (var tree in compilation.SyntaxTrees)
                    mergedCompilation = mergedCompilation.AddSyntaxTrees(tree);
            }
        }

        if (mergedCompilation is null)
            throw new InvalidOperationException(
                $"code-graph: no compilable projects found in solution '{_solutionPath}'");

        _compilation = mergedCompilation;
        _buildResult = GraphBuilder.Build(mergedCompilation);
        _staleness.MarkBuilt();
    }

    public void Dispose()
    {
        _workspace?.Dispose();
        GC.SuppressFinalize(this);
    }
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Graph/GraphManager.cs
git commit -m "feat: add GraphManager with lazy build, staleness, and compilation lifecycle"
```

---

## Task 7: MCP Tools — Stats, Search, FindCallers, FindImplementations

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\StatsTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\SearchTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindCallersTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindImplementationsTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\StatsToolTests.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindCallersToolTests.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindImplementationsToolTests.cs`

- [ ] **Step 1: Write failing tests for Stats, FindCallers, FindImplementations tools**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\StatsToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class StatsToolTests
{
    [Fact]
    public void HandleStats_Returns_Counts_And_Metadata()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("class:A", NodeType.Class, "A"));
        graph.AddNode(new GraphNode("method:A.Do()", NodeType.Method, "Do"));
        graph.AddEdge(new GraphEdge("method:A.Do()", "class:A", EdgeType.ContainedIn));

        var result = StatsHandler.Handle(
            graph,
            lastBuild: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            isStale: false,
            warnings: ["test warning"]);

        result.NodeCount.Should().Be(2);
        result.EdgeCount.Should().Be(1);
        result.IsStale.Should().BeFalse();
        result.Warnings.Should().ContainSingle("test warning");
    }
}
```

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindCallersToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class FindCallersToolTests
{
    [Fact]
    public void Returns_Direct_Callers()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A.Call()", NodeType.Method, "Call"));
        graph.AddNode(new GraphNode("method:B.Target()", NodeType.Method, "Target"));
        graph.AddEdge(new GraphEdge("method:A.Call()", "method:B.Target()", EdgeType.Calls));

        var result = FindCallersHandler.Handle(graph, "method:B.Target()", depth: 1);

        result.Callers.Should().ContainSingle(c => c.NodeId == "method:A.Call()");
    }

    [Fact]
    public void Returns_Transitive_Callers_At_Depth_2()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A.One()", NodeType.Method, "One"));
        graph.AddNode(new GraphNode("method:B.Two()", NodeType.Method, "Two"));
        graph.AddNode(new GraphNode("method:C.Three()", NodeType.Method, "Three"));
        graph.AddEdge(new GraphEdge("method:A.One()", "method:B.Two()", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:B.Two()", "method:C.Three()", EdgeType.Calls));

        var result = FindCallersHandler.Handle(graph, "method:C.Three()", depth: 2);

        result.Callers.Should().HaveCount(2);
    }

    [Fact]
    public void Returns_Error_For_Unknown_Node()
    {
        var graph = new Graph();

        var result = FindCallersHandler.Handle(graph, "method:Missing.Foo()", depth: 1);

        result.Error.Should().NotBeNullOrEmpty();
    }
}
```

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindImplementationsToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class FindImplementationsToolTests
{
    [Fact]
    public void Finds_Classes_Implementing_Interface()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("interface:IFoo", NodeType.Interface, "IFoo"));
        graph.AddNode(new GraphNode("class:FooA", NodeType.Class, "FooA"));
        graph.AddNode(new GraphNode("class:FooB", NodeType.Class, "FooB"));
        graph.AddEdge(new GraphEdge("class:FooA", "interface:IFoo", EdgeType.Implements));
        graph.AddEdge(new GraphEdge("class:FooB", "interface:IFoo", EdgeType.Implements));

        var result = FindImplementationsHandler.Handle(graph, "interface:IFoo");

        result.Implementations.Should().HaveCount(2);
    }

    [Fact]
    public void Finds_Method_Overrides()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:Base.Run()", NodeType.Method, "Run"));
        graph.AddNode(new GraphNode("method:Derived.Run()", NodeType.Method, "Run"));
        graph.AddEdge(new GraphEdge("method:Derived.Run()", "method:Base.Run()", EdgeType.OverridesMethod));

        var result = FindImplementationsHandler.Handle(graph, "method:Base.Run()");

        result.Implementations.Should().ContainSingle(i => i.NodeId == "method:Derived.Run()");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~ToolTests"
```

Expected: Compilation errors — handler classes do not exist.

- [ ] **Step 3: Implement StatsTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\StatsTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record StatsResult(
    int NodeCount,
    int EdgeCount,
    Dictionary<NodeType, int> NodesByType,
    Dictionary<EdgeType, int> EdgesByType,
    string? LastBuild,
    bool IsStale,
    List<string> Warnings);

public static class StatsHandler
{
    public static StatsResult Handle(
        Graph graph, DateTime? lastBuild, bool isStale, List<string> warnings)
    {
        var stats = graph.Stats();
        return new StatsResult(
            stats.NodeCount,
            stats.EdgeCount,
            stats.NodesByType,
            stats.EdgesByType,
            lastBuild?.ToString("O"),
            isStale,
            warnings);
    }
}

[McpServerToolType]
public class StatsTool
{
    [McpServerTool(Name = "code_stats"),
     Description("Returns aggregate statistics about the code dependency graph (node/edge counts by type, build time, staleness).")]
    public static string GetStats(GraphManager manager)
    {
        var build = manager.EnsureGraph();
        var result = StatsHandler.Handle(
            build.Graph,
            manager.LastBuildTime,
            manager.IsStale,
            build.Warnings);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 4: Implement SearchTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\SearchTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeGraph.Server.Tools;

public record SearchResult(
    string Pattern,
    string? NodeTypeFilter,
    List<SearchMatch> Matches);

public record SearchMatch(
    string NodeId,
    string NodeType,
    string Name,
    string? FilePath,
    int? Line);

[McpServerToolType]
public class SearchTool
{
    [McpServerTool(Name = "code_search"),
     Description("Search for nodes by name pattern (regex). Discovery tool: find classes, methods, etc. matching a pattern.")]
    public static string Search(
        GraphManager manager,
        [Description("Regex pattern to match against node names")] string pattern,
        [Description("Optional node type filter: Class, Interface, Enum, Method, Property, Field")]
        string? nodeType = null)
    {
        var build = manager.EnsureGraph();
        var graph = build.Graph;

        NodeType? filterType = nodeType is not null
            ? Enum.Parse<NodeType>(nodeType, ignoreCase: true)
            : null;

        var regex = new Regex(pattern, RegexOptions.IgnoreCase);
        var matches = new List<SearchMatch>();

        foreach (var node in graph.AllNodes())
        {
            if (filterType is not null && node.Type != filterType) continue;
            if (!regex.IsMatch(node.Name) && !regex.IsMatch(node.Id)) continue;

            matches.Add(new SearchMatch(
                node.Id,
                node.Type.ToString(),
                node.Name,
                node.Metadata?.GetValueOrDefault("filePath") as string,
                node.Metadata?.GetValueOrDefault("line") as int?));
        }

        var result = new SearchResult(pattern, nodeType, matches);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 5: Implement FindCallersTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindCallersTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record CallerEntry(
    string NodeId,
    string NodeType,
    string Name,
    int Depth,
    string Relationship);

public record FindCallersResult(
    string Target,
    List<CallerEntry> Callers,
    string? Error = null);

public static class FindCallersHandler
{
    public static FindCallersResult Handle(Graph graph, string target, int depth)
    {
        var node = graph.GetNode(target);
        if (node is null)
        {
            // Try prefix match
            var candidates = graph.AllNodes()
                .Where(n => n.Id.EndsWith(target, StringComparison.OrdinalIgnoreCase) ||
                            n.Name.Equals(target, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (candidates.Count == 1)
            {
                node = candidates[0];
                target = node.Id;
            }
            else
            {
                return new FindCallersResult(target, [],
                    $"Node '{target}' not found in graph" +
                    (candidates.Count > 1 ? $". Ambiguous: {string.Join(", ", candidates.Select(c => c.Id))}" : ""));
            }
        }

        var callers = new List<CallerEntry>();
        var visited = new HashSet<string> { target };
        var queue = new Queue<(string Id, int CurrentDepth)>();
        queue.Enqueue((target, 0));

        while (queue.Count > 0)
        {
            var (currentId, currentDepth) = queue.Dequeue();
            if (currentDepth >= depth) continue;

            foreach (var edge in graph.GetIncoming(currentId))
            {
                if (visited.Contains(edge.From)) continue;
                visited.Add(edge.From);

                var fromNode = graph.GetNode(edge.From);
                if (fromNode is not null)
                {
                    callers.Add(new CallerEntry(
                        fromNode.Id,
                        fromNode.Type.ToString(),
                        fromNode.Name,
                        currentDepth + 1,
                        edge.Type.ToString()));
                }

                queue.Enqueue((edge.From, currentDepth + 1));
            }
        }

        return new FindCallersResult(target, callers);
    }
}

[McpServerToolType]
public class FindCallersTool
{
    [McpServerTool(Name = "code_find_callers"),
     Description("Find what calls a method or uses a class. Returns caller chain with relationship types.")]
    public static string FindCallers(
        GraphManager manager,
        [Description("Target node ID or name")] string target,
        [Description("How many levels of callers to traverse (default: 1)")] int depth = 1)
    {
        var build = manager.EnsureGraph();
        var result = FindCallersHandler.Handle(build.Graph, target, depth);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 6: Implement FindImplementationsTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindImplementationsTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record ImplementationEntry(
    string NodeId,
    string NodeType,
    string Name);

public record FindImplementationsResult(
    string Target,
    List<ImplementationEntry> Implementations,
    string? Error = null);

public static class FindImplementationsHandler
{
    public static FindImplementationsResult Handle(Graph graph, string target)
    {
        var node = graph.GetNode(target);
        if (node is null)
        {
            var candidates = graph.AllNodes()
                .Where(n => n.Id.EndsWith(target, StringComparison.OrdinalIgnoreCase) ||
                            n.Name.Equals(target, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (candidates.Count == 1)
            {
                node = candidates[0];
                target = node.Id;
            }
            else
            {
                return new FindImplementationsResult(target, [],
                    $"Node '{target}' not found in graph");
            }
        }

        var implementations = new List<ImplementationEntry>();

        // For interfaces: find classes that implement them (incoming Implements edges)
        // For methods: find overrides (incoming OverridesMethod edges)
        var edgeType = node.Type == NodeType.Interface ? EdgeType.Implements : EdgeType.OverridesMethod;

        foreach (var edge in graph.GetIncoming(target))
        {
            if (edge.Type != edgeType) continue;
            var implNode = graph.GetNode(edge.From);
            if (implNode is null) continue;

            implementations.Add(new ImplementationEntry(
                implNode.Id,
                implNode.Type.ToString(),
                implNode.Name));
        }

        return new FindImplementationsResult(target, implementations);
    }
}

[McpServerToolType]
public class FindImplementationsTool
{
    [McpServerTool(Name = "code_find_implementations"),
     Description("Find all classes implementing an interface, or all overrides of a virtual/abstract method.")]
    public static string FindImplementations(
        GraphManager manager,
        [Description("Interface or method name/ID to find implementations of")] string target)
    {
        var build = manager.EnsureGraph();
        var result = FindImplementationsHandler.Handle(build.Graph, target);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~ToolTests"
```

Expected: All 7 tool tests pass.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Tools/ tests/CodeGraph.Tests/Tools/
git commit -m "feat: add Stats, Search, FindCallers, FindImplementations MCP tools"
```

---

## Task 8: MCP Tools — DescribeType, ImpactAnalysis, FindPaths

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\DescribeTypeTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\ImpactAnalysisTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindPathsTool.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\DescribeTypeToolTests.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\ImpactAnalysisToolTests.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindPathsToolTests.cs`

- [ ] **Step 1: Write failing tests**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\DescribeTypeToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class DescribeTypeToolTests
{
    private static Graph BuildTestGraph()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("class:MyApp.Foo", NodeType.Class, "Foo",
            new() { ["filePath"] = "Foo.cs", ["line"] = 5, ["accessibility"] = "Public" }));
        graph.AddNode(new GraphNode("interface:MyApp.IBar", NodeType.Interface, "IBar"));
        graph.AddNode(new GraphNode("method:MyApp.Foo.DoWork(int)", NodeType.Method, "DoWork",
            new() { ["accessibility"] = "Public", ["parameters"] = "int x", ["returnType"] = "void" }));
        graph.AddNode(new GraphNode("property:MyApp.Foo.Name", NodeType.Property, "Name",
            new() { ["type"] = "string" }));
        graph.AddNode(new GraphNode("method:MyApp.Foo.Helper()", NodeType.Method, "Helper"));

        graph.AddEdge(new GraphEdge("class:MyApp.Foo", "interface:MyApp.IBar", EdgeType.Implements));
        graph.AddEdge(new GraphEdge("method:MyApp.Foo.DoWork(int)", "class:MyApp.Foo", EdgeType.ContainedIn));
        graph.AddEdge(new GraphEdge("method:MyApp.Foo.Helper()", "class:MyApp.Foo", EdgeType.ContainedIn));
        graph.AddEdge(new GraphEdge("property:MyApp.Foo.Name", "class:MyApp.Foo", EdgeType.ContainedIn));
        graph.AddEdge(new GraphEdge("method:MyApp.Foo.DoWork(int)", "method:MyApp.Foo.Helper()", EdgeType.Calls));

        return graph;
    }

    [Fact]
    public void Summary_Returns_Type_Info()
    {
        var result = DescribeTypeHandler.Handle(BuildTestGraph(), "class:MyApp.Foo", "summary");

        result.Name.Should().Be("Foo");
        result.Interfaces.Should().Contain("interface:MyApp.IBar");
        result.Error.Should().BeNull();
    }

    [Fact]
    public void Members_Includes_Methods_And_Properties()
    {
        var result = DescribeTypeHandler.Handle(BuildTestGraph(), "class:MyApp.Foo", "members");

        result.Members.Should().NotBeNull();
        result.Members!.Should().Contain(m => m.Name == "DoWork");
        result.Members!.Should().Contain(m => m.Name == "Name");
    }

    [Fact]
    public void Full_Includes_Call_Targets()
    {
        var result = DescribeTypeHandler.Handle(BuildTestGraph(), "class:MyApp.Foo", "full");

        var doWork = result.Members!.First(m => m.Name == "DoWork");
        doWork.CallTargets.Should().Contain("method:MyApp.Foo.Helper()");
    }

    [Fact]
    public void Returns_Error_For_Unknown_Type()
    {
        var result = DescribeTypeHandler.Handle(new Graph(), "class:Missing", "summary");

        result.Error.Should().NotBeNullOrEmpty();
    }
}
```

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\ImpactAnalysisToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class ImpactAnalysisToolTests
{
    [Fact]
    public void Downstream_Returns_Affected_Nodes()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A.Run()", NodeType.Method, "Run"));
        graph.AddNode(new GraphNode("method:B.Call()", NodeType.Method, "Call"));
        graph.AddEdge(new GraphEdge("method:A.Run()", "method:B.Call()", EdgeType.Calls));

        var result = ImpactAnalysisHandler.Handle(graph, "method:A.Run()", "downstream");

        result.Affected.Should().ContainSingle(a => a.NodeId == "method:B.Call()");
    }

    [Fact]
    public void Upstream_Returns_Callers()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A.Run()", NodeType.Method, "Run"));
        graph.AddNode(new GraphNode("method:B.Call()", NodeType.Method, "Call"));
        graph.AddEdge(new GraphEdge("method:A.Run()", "method:B.Call()", EdgeType.Calls));

        var result = ImpactAnalysisHandler.Handle(graph, "method:B.Call()", "upstream");

        result.Affected.Should().ContainSingle(a => a.NodeId == "method:A.Run()");
    }

    [Fact]
    public void Both_Returns_All_Directions()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A()", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B()", NodeType.Method, "B"));
        graph.AddNode(new GraphNode("method:C()", NodeType.Method, "C"));
        graph.AddEdge(new GraphEdge("method:A()", "method:B()", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:B()", "method:C()", EdgeType.Calls));

        var result = ImpactAnalysisHandler.Handle(graph, "method:B()", "both");

        result.Affected.Should().HaveCount(2);
    }
}
```

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\tests\CodeGraph.Tests\Tools\FindPathsToolTests.cs`:

```csharp
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using FluentAssertions;

namespace CodeGraph.Tests.Tools;

public class FindPathsToolTests
{
    [Fact]
    public void Finds_Direct_Path()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A()", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B()", NodeType.Method, "B"));
        graph.AddEdge(new GraphEdge("method:A()", "method:B()", EdgeType.Calls));

        var result = FindPathsHandler.Handle(graph, "method:A()", "method:B()");

        result.Paths.Should().ContainSingle();
        result.Paths[0].Length.Should().Be(1);
    }

    [Fact]
    public void Finds_Multiple_Paths()
    {
        var graph = new Graph();
        graph.AddNode(new GraphNode("method:A()", NodeType.Method, "A"));
        graph.AddNode(new GraphNode("method:B()", NodeType.Method, "B"));
        graph.AddNode(new GraphNode("method:C()", NodeType.Method, "C"));
        graph.AddEdge(new GraphEdge("method:A()", "method:B()", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:B()", "method:C()", EdgeType.Calls));
        graph.AddEdge(new GraphEdge("method:A()", "method:C()", EdgeType.Calls));

        var result = FindPathsHandler.Handle(graph, "method:A()", "method:C()");

        result.Paths.Should().HaveCount(2);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~DescribeType or FullyQualifiedName~ImpactAnalysis or FullyQualifiedName~FindPaths"
```

Expected: Compilation errors — handler classes do not exist.

- [ ] **Step 3: Implement DescribeTypeTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\DescribeTypeTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record MemberInfo(
    string Id,
    string MemberType,
    string Name,
    string? Accessibility,
    string? ReturnType,
    string? Parameters,
    List<string>? CallTargets,
    List<string>? FieldReads,
    List<string>? FieldWrites);

public record DescribeTypeResult(
    string TypeId,
    string Name,
    string NodeType,
    string? BaseClass,
    List<string> Interfaces,
    string? FilePath,
    int? Line,
    List<MemberInfo>? Members,
    string? Error = null);

public static class DescribeTypeHandler
{
    public static DescribeTypeResult Handle(Graph graph, string target, string depth)
    {
        var node = graph.GetNode(target);
        if (node is null)
        {
            var candidates = graph.AllNodes()
                .Where(n => (n.Type is NodeType.Class or NodeType.Interface or NodeType.Enum) &&
                            (n.Id.EndsWith(target, StringComparison.OrdinalIgnoreCase) ||
                             n.Name.Equals(target, StringComparison.OrdinalIgnoreCase)))
                .ToList();
            if (candidates.Count == 1)
            {
                node = candidates[0];
                target = node.Id;
            }
            else
            {
                return new DescribeTypeResult(target, target, "Unknown", null, [], null, null, null,
                    $"Type '{target}' not found in graph");
            }
        }

        // Base class
        var baseClass = graph.GetOutgoing(target)
            .Where(e => e.Type == EdgeType.Inherits)
            .Select(e => e.To)
            .FirstOrDefault();

        // Interfaces
        var interfaces = graph.GetOutgoing(target)
            .Where(e => e.Type == EdgeType.Implements)
            .Select(e => e.To)
            .ToList();

        var result = new DescribeTypeResult(
            target,
            node.Name,
            node.Type.ToString(),
            baseClass,
            interfaces,
            node.Metadata?.GetValueOrDefault("filePath") as string,
            node.Metadata?.GetValueOrDefault("line") as int?,
            null);

        if (depth == "summary") return result;

        // Members
        var memberEdges = graph.GetIncoming(target)
            .Where(e => e.Type == EdgeType.ContainedIn);

        var members = new List<MemberInfo>();
        foreach (var edge in memberEdges)
        {
            var memberNode = graph.GetNode(edge.From);
            if (memberNode is null) continue;

            List<string>? callTargets = null;
            List<string>? fieldReads = null;
            List<string>? fieldWrites = null;

            if (depth == "full")
            {
                var outgoing = graph.GetOutgoing(memberNode.Id);
                callTargets = outgoing.Where(e => e.Type == EdgeType.Calls).Select(e => e.To).ToList();
                fieldReads = outgoing.Where(e => e.Type == EdgeType.ReadsField).Select(e => e.To).ToList();
                fieldWrites = outgoing.Where(e => e.Type == EdgeType.WritesField).Select(e => e.To).ToList();
            }

            members.Add(new MemberInfo(
                memberNode.Id,
                memberNode.Type.ToString(),
                memberNode.Name,
                memberNode.Metadata?.GetValueOrDefault("accessibility") as string,
                memberNode.Metadata?.GetValueOrDefault("returnType") as string,
                memberNode.Metadata?.GetValueOrDefault("parameters") as string,
                callTargets,
                fieldReads,
                fieldWrites));
        }

        return result with { Members = members };
    }
}

[McpServerToolType]
public class DescribeTypeTool
{
    [McpServerTool(Name = "code_describe_type"),
     Description("Describe a class or interface at three detail levels: summary, members, or full (including call targets and field access).")]
    public static string DescribeType(
        GraphManager manager,
        [Description("Type name or full node ID")] string name,
        [Description("Detail level: summary, members, or full")] string depth = "summary")
    {
        var build = manager.EnsureGraph();
        var result = DescribeTypeHandler.Handle(build.Graph, name, depth);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 4: Implement ImpactAnalysisTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\ImpactAnalysisTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record AffectedEntry(
    string NodeId,
    string NodeType,
    string Name,
    int Depth);

public record ImpactAnalysisResult(
    string Target,
    string Direction,
    List<AffectedEntry> Affected,
    string? Error = null);

public static class ImpactAnalysisHandler
{
    public static ImpactAnalysisResult Handle(
        Graph graph, string target, string direction, int maxDepth = 10)
    {
        var node = graph.GetNode(target);
        if (node is null)
        {
            var candidates = graph.AllNodes()
                .Where(n => n.Id.EndsWith(target, StringComparison.OrdinalIgnoreCase) ||
                            n.Name.Equals(target, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (candidates.Count == 1)
            {
                node = candidates[0];
                target = node.Id;
            }
            else
            {
                return new ImpactAnalysisResult(target, direction, [],
                    $"Node '{target}' not found in graph");
            }
        }

        var seen = new Dictionary<string, AffectedEntry>();

        void Collect(string dir)
        {
            var results = dir == "downstream"
                ? graph.TraverseDownstream(target)
                : graph.TraverseUpstream(target);

            foreach (var r in results)
            {
                if (r.Depth > maxDepth) continue;
                if (!seen.ContainsKey(r.Node.Id))
                {
                    seen[r.Node.Id] = new AffectedEntry(
                        r.Node.Id,
                        r.Node.Type.ToString(),
                        r.Node.Name,
                        r.Depth);
                }
            }
        }

        if (direction is "upstream" or "both") Collect("upstream");
        if (direction is "downstream" or "both") Collect("downstream");

        return new ImpactAnalysisResult(target, direction, [.. seen.Values]);
    }
}

[McpServerToolType]
public class ImpactAnalysisTool
{
    [McpServerTool(Name = "code_impact_analysis"),
     Description("If this method/class changes, what's affected? Traverses callers (upstream) or callees (downstream).")]
    public static string ImpactAnalysis(
        GraphManager manager,
        [Description("Target node ID or name")] string target,
        [Description("Traversal direction: upstream, downstream, or both")] string direction = "both",
        [Description("Maximum traversal depth")] int maxDepth = 10)
    {
        var build = manager.EnsureGraph();
        var result = ImpactAnalysisHandler.Handle(build.Graph, target, direction, maxDepth);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 5: Implement FindPathsTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\FindPathsTool.cs`:

```csharp
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

public record PathEdge(string From, string To, string EdgeType);

public record PathResult(List<PathEdge> Edges, int Length);

public record FindPathsResult(
    string From,
    string To,
    List<PathResult> Paths,
    string? Error = null);

public static class FindPathsHandler
{
    public static FindPathsResult Handle(
        Graph graph, string from, string to, int maxDepth = 20)
    {
        var fromNode = graph.GetNode(from);
        var toNode = graph.GetNode(to);

        if (fromNode is null || toNode is null)
        {
            var missing = fromNode is null ? from : to;
            return new FindPathsResult(from, to, [],
                $"Node '{missing}' not found in graph");
        }

        var rawPaths = graph.FindPaths(from, to, maxDepth);
        var paths = rawPaths.Select(edgeList => new PathResult(
            edgeList.Select(e => new PathEdge(e.From, e.To, e.Type.ToString())).ToList(),
            edgeList.Count)).ToList();

        return new FindPathsResult(from, to, paths);
    }
}

[McpServerToolType]
public class FindPathsTool
{
    [McpServerTool(Name = "code_find_paths"),
     Description("Find all dependency paths between two nodes. E.g., 'How does MainMenu reach AdfRunStepHandler?'")]
    public static string FindPaths(
        GraphManager manager,
        [Description("Source node ID or name")] string from,
        [Description("Target node ID or name")] string to,
        [Description("Maximum path depth")] int maxDepth = 20)
    {
        var build = manager.EnsureGraph();
        var result = FindPathsHandler.Handle(build.Graph, from, to, maxDepth);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test --filter "FullyQualifiedName~DescribeType or FullyQualifiedName~ImpactAnalysis or FullyQualifiedName~FindPaths"
```

Expected: All 9 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Tools/ tests/CodeGraph.Tests/Tools/
git commit -m "feat: add DescribeType, ImpactAnalysis, FindPaths MCP tools"
```

---

## Task 9: DataFlow Tool (Fine-Grained Roslyn Drill-Down)

**Files:**
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Analysis\DataFlowAnalyzer.cs`
- Create: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\DataFlowTool.cs`

This is the adaptive "fine" layer — queries the live Roslyn `Compilation` on demand.

- [ ] **Step 1: Implement DataFlowAnalyzer**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Analysis\DataFlowAnalyzer.cs`:

```csharp
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace CodeGraph.Server.Analysis;

public record DataFlowStep(
    string Variable,
    string Kind,
    string? SourceExpression,
    int Line);

public record DataFlowResult(
    string Method,
    string? Parameter,
    List<DataFlowStep> Steps,
    List<string> Warnings);

public static class DataFlowAnalyzer
{
    public static DataFlowResult Analyze(
        Compilation compilation, string methodId, string? parameterName)
    {
        var warnings = new List<string>();
        var steps = new List<DataFlowStep>();

        // Find the method's syntax node by matching the method ID
        MethodDeclarationSyntax? targetMethod = null;
        SemanticModel? targetModel = null;

        foreach (var tree in compilation.SyntaxTrees)
        {
            var model = compilation.GetSemanticModel(tree);
            foreach (var method in tree.GetRoot().DescendantNodes().OfType<MethodDeclarationSyntax>())
            {
                var symbol = model.GetDeclaredSymbol(method);
                if (symbol is null) continue;

                var fqn = GetMethodId(symbol);
                if (fqn.Equals(methodId, StringComparison.OrdinalIgnoreCase) ||
                    methodId.EndsWith(symbol.Name, StringComparison.OrdinalIgnoreCase))
                {
                    targetMethod = method;
                    targetModel = model;
                    break;
                }
            }
            if (targetMethod is not null) break;
        }

        if (targetMethod is null || targetModel is null)
        {
            return new DataFlowResult(methodId, parameterName, [],
                [$"Method '{methodId}' not found"]);
        }

        var bodyNode = (SyntaxNode?)targetMethod.Body ?? targetMethod.ExpressionBody;
        if (bodyNode is null)
        {
            return new DataFlowResult(methodId, parameterName, [],
                ["Method has no body"]);
        }

        // Use Roslyn's data flow analysis
        if (bodyNode is BlockSyntax block)
        {
            var dataFlow = targetModel.AnalyzeDataFlow(block);
            if (dataFlow is not null && dataFlow.Succeeded)
            {
                foreach (var variable in dataFlow.VariablesDeclared)
                {
                    if (parameterName is not null &&
                        !variable.Name.Equals(parameterName, StringComparison.OrdinalIgnoreCase))
                        continue;

                    var kind = dataFlow.AlwaysAssigned.Contains(variable) ? "always_assigned" : "declared";
                    var location = variable.Locations.FirstOrDefault();
                    var line = location?.GetLineSpan().StartLinePosition.Line + 1 ?? 0;

                    steps.Add(new DataFlowStep(variable.Name, kind, null, line));
                }

                foreach (var read in dataFlow.ReadInside)
                {
                    if (parameterName is not null &&
                        !read.Name.Equals(parameterName, StringComparison.OrdinalIgnoreCase))
                        continue;

                    var location = read.Locations.FirstOrDefault();
                    var line = location?.GetLineSpan().StartLinePosition.Line + 1 ?? 0;
                    steps.Add(new DataFlowStep(read.Name, "read", null, line));
                }

                foreach (var written in dataFlow.WrittenInside)
                {
                    if (parameterName is not null &&
                        !written.Name.Equals(parameterName, StringComparison.OrdinalIgnoreCase))
                        continue;

                    if (written.Name == "this") continue;
                    var location = written.Locations.FirstOrDefault();
                    var line = location?.GetLineSpan().StartLinePosition.Line + 1 ?? 0;
                    steps.Add(new DataFlowStep(written.Name, "written", null, line));
                }
            }
        }

        return new DataFlowResult(methodId, parameterName, steps, warnings);
    }

    private static string GetMethodId(IMethodSymbol method)
    {
        var ns = method.ContainingType.ContainingNamespace;
        var typeFqn = ns is null || ns.IsGlobalNamespace
            ? method.ContainingType.Name
            : $"{ns.ToDisplayString()}.{method.ContainingType.Name}";
        var paramList = string.Join(",",
            method.Parameters.Select(p => p.Type.ToDisplayString(
                SymbolDisplayFormat.MinimallyQualifiedFormat)));
        return $"method:{typeFqn}.{method.Name}({paramList})";
    }
}
```

- [ ] **Step 2: Implement DataFlowTool**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Tools\DataFlowTool.cs`:

```csharp
using CodeGraph.Server.Analysis;
using CodeGraph.Server.Graph;
using ModelContextProtocol.Server;
using System.ComponentModel;
using System.Text.Json;

namespace CodeGraph.Server.Tools;

[McpServerToolType]
public class DataFlowTool
{
    [McpServerTool(Name = "code_data_flow"),
     Description("Fine-grained Roslyn data flow analysis. Traces how data flows through a specific method: parameters, assignments, returns.")]
    public static string AnalyzeDataFlow(
        GraphManager manager,
        [Description("Method name or full ID to analyze")] string method,
        [Description("Optional specific parameter to trace")] string? parameter = null)
    {
        var compilation = manager.EnsureCompilation();
        var result = DataFlowAnalyzer.Analyze(compilation, method, parameter);
        return JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
    }
}
```

- [ ] **Step 3: Verify build succeeds**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Analysis/ src/CodeGraph.Server/Tools/DataFlowTool.cs
git commit -m "feat: add DataFlowAnalyzer and code_data_flow MCP tool"
```

---

## Task 10: Wire Up Program.cs and End-to-End Test

**Files:**
- Modify: `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Program.cs`

- [ ] **Step 1: Update Program.cs with full server setup**

Write to `C:\Users\shurley\source\repos\HurleySk\code-graph\src\CodeGraph.Server\Program.cs`:

```csharp
using CodeGraph.Server;
using CodeGraph.Server.Graph;
using CodeGraph.Server.Tools;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

var appDir = AppContext.BaseDirectory;
var config = ConfigLoader.Load(appDir);
var manager = new GraphManager(config.Solution);

builder.Services.AddSingleton(manager);

builder.Services.AddMcpServer(options =>
    {
        options.ServerInfo = new()
        {
            Name = "code-graph",
            Version = "0.1.0"
        };
    })
    .WithStdioServerTransport()
    .WithTools<StatsTool>()
    .WithTools<SearchTool>()
    .WithTools<FindCallersTool>()
    .WithTools<FindImplementationsTool>()
    .WithTools<DescribeTypeTool>()
    .WithTools<ImpactAnalysisTool>()
    .WithTools<FindPathsTool>()
    .WithTools<DataFlowTool>();

builder.Logging.AddConsole(options =>
{
    options.LogToStandardErrorThreshold = LogLevel.Trace;
});

await builder.Build().RunAsync();
```

- [ ] **Step 2: Verify build succeeds**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Run all tests**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
dotnet test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/shurley/source/repos/HurleySk/code-graph
git add src/CodeGraph.Server/Program.cs
git commit -m "feat: wire up all MCP tools in Program.cs with DI and config"
```

---

## Task 11: Clean Up Source Repo

**Files:**
- Delete: `C:\Users\shurley\source\repos\HurleySk\adf-graph\docs\` (only if it contains nothing besides `superpowers/`)

- [ ] **Step 1: Check docs directory contents**

```bash
ls /c/Users/shurley/source/repos/HurleySk/adf-graph/docs/
```

If it only contains `superpowers/`, proceed to delete.

- [ ] **Step 2: Delete docs directory if appropriate**

```bash
cd /c/Users/shurley/source/repos/HurleySk/adf-graph
rm -rf docs/
git add -A
git commit -m "chore: remove superpowers planning artifacts"
```

- [ ] **Step 3: Register MCP server in Claude Code settings (manual step)**

Add to Claude Code's MCP config (user to verify path):

```json
{
  "mcpServers": {
    "code-graph": {
      "command": "dotnet",
      "args": ["run", "--project", "C:/Users/shurley/source/repos/HurleySk/code-graph/src/CodeGraph.Server"],
      "env": {
        "CODE_GRAPH_SOLUTION": "C:/Users/shurley/source/repos/HurleySk/boomerang-/tools/Boomerang/Boomerang.sln"
      }
    }
  }
}
```

Note: The actual .sln path for boomerang- needs to be verified — the Boomerang CLI is at `tools/Boomerang/` inside the boomerang- repo.
