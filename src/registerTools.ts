import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GraphManager } from "./graph/manager.js";
import { handleStats } from "./tools/stats.js";
import { handleFindConsumers } from "./tools/consumers.js";
import { handleDescribePipeline } from "./tools/describe.js";
import { handleImpactAnalysis } from "./tools/impact.js";
import { handleDataLineage } from "./tools/lineage.js";
import { handleFindPaths } from "./tools/paths.js";
import { handleDiffPipeline } from "./tools/diff.js";
import { handleAddOverlay } from "./tools/addOverlay.js";
import { handleRemoveOverlay } from "./tools/removeOverlay.js";
import { handleListOverlays } from "./tools/listOverlays.js";
import { handleAddEnvironment } from "./tools/addEnvironment.js";
import { handleRemoveEnvironment } from "./tools/removeEnvironment.js";
import { handleDeployReadiness } from "./tools/deployReadiness.js";
import { handleTraceParameters } from "./tools/traceParameters.js";
import { handleFindOrchestrators } from "./tools/findOrchestrators.js";
import { handleDiffEnvironments } from "./tools/diffEnvironments.js";
import { handleValidate } from "./tools/validate.js";
import { handleEnhancedSearch } from "./tools/enhancedSearch.js";
import { handleTraceConnection } from "./tools/traceConnection.js";
import { handleCrossEnvArtifact } from "./tools/crossEnvArtifact.js";
import { handleDescribeEntity } from "./tools/describeEntity.js";
import { handleValidatePipeline } from "./tools/validatePipeline.js";
import { handleValidateStatuscode } from "./tools/validateStatuscode.js";
import { handleFindBadColumns } from "./tools/findBadColumns.js";
import { handleIgnoreNullValuesAudit } from "./tools/ignoreNullValuesAudit.js";
import { handleStagingDependencies } from "./tools/stagingDependencies.js";
import { handleEntityCoverage } from "./tools/entityCoverage.js";
import { handleParameterCallers } from "./tools/parameterCallers.js";
import { handleDiffStaging } from "./tools/diffStaging.js";
import { handleGenerateScope } from "./tools/generateScope.js";
import { handleFilterChain } from "./tools/filterChain.js";
import { handleCdcAnalysis } from "./tools/cdcAnalysis.js";
import { handleStagingPopulation } from "./tools/stagingPopulation.js";
import { handleValidateStagingColumns } from "./tools/validateStagingColumns.js";
import { handleExport } from "./tools/export.js";

const environmentParam = z
  .string()
  .optional()
  .describe("Environment name. If omitted, uses the default environment.");

const nodeTypeEnum = z.enum([
  "pipeline", "activity", "dataset", "stored_procedure", "table",
  "dataverse_entity", "dataverse_attribute", "linked_service", "key_vault_secret",
]);

function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerTools(server: McpServer, manager: GraphManager): void {
  // ── Query tools ──────────────────────────────────────────────────────

  server.tool(
    "graph_stats",
    "Returns aggregate statistics about the ADF dependency graph (node/edge counts by type, build time, staleness).",
    { environment: environmentParam },
    async ({ environment }) => {
      const build = manager.ensureGraph(environment);
      const envName = environment ?? manager.getDefaultEnvironment();
      const envInfo = manager.listEnvironments().find((e) => e.name === envName);
      return json(handleStats(build.graph, envInfo?.lastBuild ?? null, envInfo?.isStale ?? true, build.warnings));
    },
  );

  server.tool(
    "graph_export",
    "Export the full graph (all nodes and edges) as a single JSON payload. Designed for visualization tools that need the complete topology.",
    { environment: environmentParam },
    async ({ environment }) => {
      const build = manager.ensureGraph(environment);
      const envName = environment ?? manager.getDefaultEnvironment();
      return json(handleExport(build.graph, envName));
    },
  );

  server.tool(
    "graph_find_consumers",
    "Find all pipeline activities that consume a given dataset, table, stored procedure, or Dataverse entity.",
    {
      target: z.string().describe("Name of the target artifact (e.g. 'businessunit')"),
      target_type: nodeTypeEnum.describe("Node type of the target"),
      environment: environmentParam,
    },
    async ({ target, target_type, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleFindConsumers(build.graph, target, target_type));
    },
  );

  server.tool(
    "graph_describe_pipeline",
    "Describe a pipeline: summary, activities, full detail, or resolved (inlines parameter values for child pipeline calls, detects CDC patterns). Optionally filter to a single named activity.",
    {
      pipeline: z.string().describe("Pipeline name"),
      depth: z.enum(["summary", "activities", "full", "resolved"]).default("summary").describe("Level of detail. 'resolved' inlines parameter values for ExecutePipeline activities and detects CDC patterns."),
      activity: z.string().optional().describe("Optional activity name — returns full detail for just that activity"),
      environment: environmentParam,
    },
    async ({ pipeline, depth, activity, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleDescribePipeline(build.graph, pipeline, depth, activity));
    },
  );

  server.tool(
    "graph_describe_entity",
    "Describe a Dataverse entity: metadata, attributes, and pipeline consumers. At 'full' depth, includes attribute types, required levels, and create/update flags from the schema file.",
    {
      entity: z.string().describe("Dataverse entity logical name (e.g. 'alm_organization')"),
      depth: z.enum(["summary", "full"]).default("summary").describe("'summary' = names only; 'full' = attribute types, required levels, create/update flags"),
      environment: environmentParam,
    },
    async ({ entity, depth, environment }) => {
      const build = manager.ensureGraph(environment);
      const schemaPath = manager.getSchemaPath(environment ?? manager.getDefaultEnvironment());
      return json(handleDescribeEntity(build.graph, entity, depth, schemaPath));
    },
  );

  server.tool(
    "graph_impact_analysis",
    "Analyse which nodes are affected if a given artifact changes. Traverses upstream, downstream, or both.",
    {
      target: z.string().describe("Name of the artifact to analyse"),
      target_type: nodeTypeEnum.describe("Node type of the target"),
      direction: z.enum(["upstream", "downstream", "both"]).default("both").describe("Traversal direction"),
      environment: environmentParam,
    },
    async ({ target, target_type, direction, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleImpactAnalysis(build.graph, target, target_type, direction));
    },
  );

  server.tool(
    "graph_data_lineage",
    "Trace data lineage for a Dataverse entity or staging table. Optionally filter to a single attribute/column.",
    {
      entity: z.string().describe("Entity or table name. Accepts bare name ('Org_Staging'), schema-qualified ('dbo.Org_Staging'), full node ID ('table:dbo.Org_Staging'), or Dataverse entity ('businessunit'). Case-insensitive."),
      attribute: z.string().optional().describe("Optional attribute/column name for column-level lineage"),
      direction: z.enum(["upstream", "downstream"]).describe("'upstream' = what feeds this node; 'downstream' = what this node feeds"),
      maxDepth: z.number().int().min(1).optional().describe("Maximum traversal depth (hops). Omit for unlimited."),
      detail: z.enum(["summary", "full"]).default("summary").describe("'summary' = unique nodes grouped by type; 'full' = complete paths"),
      nodeTypes: z.array(z.string()).optional().describe("Filter to these node types (e.g. ['table', 'dataverse_entity'])"),
      limit: z.number().int().min(1).optional().describe("Max paths to return (full mode only)"),
      offset: z.number().int().min(0).optional().describe("Paths to skip (full mode only)"),
      environment: environmentParam,
    },
    async ({ entity, attribute, direction, maxDepth, detail, nodeTypes, limit, offset, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleDataLineage(build.graph, entity, { attribute, direction, maxDepth, detail, nodeTypes, limit, offset }));
    },
  );

  server.tool(
    "graph_find_paths",
    "Find all dependency paths between two nodes in the graph.",
    {
      from: z.string().describe("Source node name"),
      to: z.string().describe("Target node name"),
      from_type: z.string().optional().describe("Node type of the source (e.g. 'pipeline')"),
      to_type: z.string().optional().describe("Node type of the target (e.g. 'dataverse_entity')"),
      environment: environmentParam,
    },
    async ({ from, to, from_type, to_type, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleFindPaths(build.graph, from, to, from_type, to_type));
    },
  );

  server.tool(
    "graph_find_orchestrators",
    "Find root orchestrator pipelines that own a given pipeline. Returns full ancestry chains with depth.",
    {
      pipeline: z.string().describe("Pipeline name to trace ancestry for"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleFindOrchestrators(build.graph, pipeline));
    },
  );

  server.tool(
    "graph_search",
    "Flexible search across the graph: node names, activity SQL, FetchXML, stored procedure names/parameters, and ExecutePipeline parameter values. Supports filters for activity type, node type, target entity, and pipeline scope.",
    {
      query: z.string().min(1).describe("Search text (case-insensitive substring match)"),
      activityType: z.string().optional().describe("Filter to activities of this type (e.g. 'Copy', 'ExecutePipeline')"),
      nodeType: z.string().optional().describe("Filter to this node type (e.g. 'pipeline', 'dataset')"),
      targetEntity: z.string().optional().describe("Filter to activities that reference this entity/table"),
      pipeline: z.string().optional().describe("Filter to activities within this pipeline"),
      detail: z.enum(["summary", "full"]).default("summary").describe("Level of detail per hit"),
      environment: environmentParam,
    },
    async ({ query, activityType, nodeType, targetEntity, pipeline, detail, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleEnhancedSearch(build.graph, query, { activityType, nodeType, targetEntity, pipeline, detail }));
    },
  );

  server.tool(
    "graph_trace_connection",
    "Trace the full connection chain from a pipeline's activities through datasets, linked services, and credentials. Returns serviceUri, servicePrincipalId, and Key Vault secret references for each connection.",
    {
      pipeline: z.string().describe("Pipeline name to trace connections for"),
      activity: z.string().optional().describe("Optional activity name — traces only that activity's connections"),
      environment: environmentParam,
    },
    async ({ pipeline, activity, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleTraceConnection(build.graph, pipeline, activity));
    },
  );

  // ── Diff & comparison tools ──────────────────────────────────────────

  server.tool(
    "graph_diff_pipeline",
    "Compare a pipeline's structure across two environments. Shows added/removed/modified activities, SQL changes, and column mapping differences.",
    {
      pipeline: z.string().describe("Pipeline name to compare"),
      envA: z.string().describe("First environment name"),
      envB: z.string().describe("Second environment name"),
    },
    async ({ pipeline, envA, envB }) => {
      const buildA = manager.ensureGraph(envA);
      const buildB = manager.ensureGraph(envB);
      return json(handleDiffPipeline(buildA.graph, buildB.graph, pipeline, envA, envB));
    },
  );

  server.tool(
    "graph_diff_environments",
    "Compare pipelines across two environments. Returns added/removed/changed pipelines with summary-level diffs.",
    {
      envA: z.string().describe("First environment name"),
      envB: z.string().describe("Second environment name"),
      scope: z.enum(["pipelines", "all"]).default("pipelines").describe("What to compare: pipelines only or all artifact types"),
    },
    async ({ envA, envB, scope }) => {
      return json(handleDiffEnvironments(manager, envA, envB, scope));
    },
  );

  server.tool(
    "graph_diff_staging",
    "Compare staged pipeline changes against the deployed version. Auto-detects staging and deployed environments from config, or accepts explicit environment names.",
    {
      pipeline: z.string().describe("Pipeline name to compare"),
      staging_env: z.string().optional().describe("Staging environment name (auto-detected if omitted)"),
      deployed_env: z.string().optional().describe("Deployed environment name (auto-detected if omitted)"),
    },
    async ({ pipeline, staging_env, deployed_env }) => {
      return json(handleDiffStaging(manager, pipeline, staging_env, deployed_env));
    },
  );

  server.tool(
    "graph_cross_env_artifact",
    "Compare a single artifact across all registered environments. Shows per-environment metadata with field-level diffs to spot configuration inconsistencies (e.g. different serviceUri across factories).",
    {
      name: z.string().describe("Artifact name (e.g. 'LS_ALMDATAVERSEUSER4_USGOVVA_01')"),
      artifact_type: z.enum(["pipeline", "dataset", "linked_service"]).describe("Type of artifact to compare"),
    },
    async ({ name, artifact_type }) => {
      return json(handleCrossEnvArtifact(manager, name, artifact_type));
    },
  );

  // ── Validation tools ─────────────────────────────────────────────────

  server.tool(
    "graph_validate",
    "Run graph-wide validation: broken references, empty-default parameters without suppliers, unused datasets, orphaned nodes, cross-org Dataverse URI mismatches. Returns errors and warnings.",
    {
      environment: environmentParam,
      severity: z.enum(["all", "error", "warning"]).default("all").describe("Filter by severity"),
    },
    async ({ environment, severity }) => {
      const build = manager.ensureGraph(environment);
      const envName = environment ?? manager.getDefaultEnvironment();
      const schemaPath = manager.getSchemaPath(envName);
      return json(handleValidate(build.graph, envName, severity, schemaPath));
    },
  );

  server.tool(
    "graph_validate_pipeline",
    "Validate dest_query column aliases against Dataverse entity schema. Checks that each SQL alias maps to a valid entity attribute, flags invalid columns, and whitelists system attributes.",
    {
      pipeline: z.string().describe("Pipeline name"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      const schemaPath = manager.getSchemaPath(environment ?? manager.getDefaultEnvironment());
      return json(handleValidatePipeline(build.graph, pipeline, schemaPath));
    },
  );

  server.tool(
    "graph_validate_statuscode",
    "Validate CASE WHEN values for statuscode/statecode columns in dest_query against Dataverse OptionSet metadata. Checks that integer values map to valid OptionSet options.",
    {
      pipeline: z.string().describe("Pipeline name"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      const schemaPath = manager.getSchemaPath(environment ?? manager.getDefaultEnvironment());
      return json(handleValidateStatuscode(build.graph, pipeline, schemaPath));
    },
  );

  server.tool(
    "graph_find_bad_columns",
    "Bulk audit: scan all pipelines for dest_query parameters and report every column alias that does not match a Dataverse entity attribute.",
    { environment: environmentParam },
    async ({ environment }) => {
      const build = manager.ensureGraph(environment);
      const schemaPath = manager.getSchemaPath(environment ?? manager.getDefaultEnvironment());
      return json(handleFindBadColumns(build.graph, schemaPath));
    },
  );

  server.tool(
    "graph_validate_staging_columns",
    "Validate source_query SELECT columns against staging table DDL. Detects column name mismatches that cause ADF auto-mapping failures at runtime. Warns when Copy activities use zero explicit mappings.",
    {
      pipeline: z.string().optional().describe("Pipeline name. If omitted, scans all pipelines."),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleValidateStagingColumns(build.graph, pipeline));
    },
  );

  server.tool(
    "graph_ignore_null_values_audit",
    "Scan all Copy activities writing to Dataverse and flag those with ignoreNullValues absent or false. This dangerous default causes NULL source columns to overwrite existing Dataverse values.",
    {
      detail: z.enum(["summary", "full"]).default("summary").describe("'summary' = per-pipeline counts; 'full' = every flagged activity"),
      environment: environmentParam,
    },
    async ({ detail, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleIgnoreNullValuesAudit(build.graph, detail));
    },
  );

  server.tool(
    "graph_staging_dependencies",
    "Map shared staging table usage across pipelines. Shows which pipelines read/write each table, flags shared tables where concurrent execution risks data corruption, and detects TRUNCATE TABLE patterns.",
    {
      table: z.string().optional().describe("Filter to tables matching this name (case-insensitive substring)"),
      environment: environmentParam,
    },
    async ({ table, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleStagingDependencies(build.graph, table));
    },
  );

  server.tool(
    "graph_entity_coverage",
    "Show all pipelines writing to a Dataverse entity with per-pipeline column lists. Highlights column differences across pipelines to detect mapping inconsistencies.",
    {
      entity: z.string().describe("Dataverse entity logical name (e.g. 'alm_workset')"),
      detail: z.enum(["summary", "full"]).default("summary").describe("'summary' = columns + frequency only; 'full' = per-pipeline coverage entries"),
      environment: environmentParam,
    },
    async ({ entity, detail, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleEntityCoverage(build.graph, entity, detail));
    },
  );

  // ── Parameter tracing tools ──────────────────────────────────────────

  server.tool(
    "graph_trace_parameters",
    "Trace parameter flow through ExecutePipeline chains from a root pipeline. Maps each parameter from source to sink and flags dead-ends: parameters with empty/null defaults that no caller supplies a value for.",
    {
      pipeline: z.string().describe("Root pipeline name to trace from"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleTraceParameters(build.graph, pipeline));
    },
  );

  server.tool(
    "graph_parameter_trace",
    "Trace parameter values from parent to child pipelines. For a given pipeline, show what each caller supplies for each parameter via ExecutePipeline activities. Flags dead-end parameters with no supplier.",
    {
      pipeline: z.string().describe("Pipeline name to inspect callers for"),
      parameter: z.string().optional().describe("Filter to a specific parameter name"),
      environment: environmentParam,
    },
    async ({ pipeline, parameter, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleParameterCallers(build.graph, pipeline, parameter));
    },
  );

  // ── Deploy & readiness tools ─────────────────────────────────────────

  server.tool(
    "graph_deploy_readiness",
    "Pre-flight check: walks the full dependency tree of a pipeline and reports what artifacts are present, stub (referenced but no file), or missing in the target environment. Also flags parameters with empty/null defaults that no parent supplies. Optionally compares linked service configuration against another environment.",
    {
      pipeline: z.string().describe("Root pipeline name to check"),
      environment: environmentParam,
      compare_env: z.string().optional().describe("Optional environment name to compare linked service config against (flags serviceUri/credential differences)"),
    },
    async ({ pipeline, environment, compare_env }) => {
      const build = manager.ensureGraph(environment);
      const schemaPath = manager.getSchemaPath(environment ?? manager.getDefaultEnvironment());
      const compareResult = compare_env ? manager.ensureGraph(compare_env) : undefined;
      return json(handleDeployReadiness(build.graph, pipeline, compareResult?.graph, compare_env, schemaPath));
    },
  );

  // ── Environment management tools ─────────────────────────────────────

  server.tool(
    "graph_list_environments",
    "List all configured environments with their paths, default status, and graph statistics (node/edge counts, last build time, staleness).",
    {},
    async () => json(manager.listEnvironments()),
  );

  server.tool(
    "graph_add_overlay",
    "Add an overlay path (directory or file) to an environment. The overlay's artifacts are merged on top of the base graph in a separate merged view. Runtime overlays are ephemeral (lost on restart).",
    {
      environment: z.string().describe("Base environment name to overlay onto"),
      path: z.string().describe("Path to overlay directory or file"),
    },
    async ({ environment, path }) => json(handleAddOverlay(manager, environment, path)),
  );

  server.tool(
    "graph_remove_overlay",
    "Remove a runtime overlay from an environment. Config-based overlays cannot be removed via this tool.",
    {
      environment: z.string().describe("Environment name"),
      path: z.string().describe("Overlay path to remove"),
    },
    async ({ environment, path }) => json(handleRemoveOverlay(manager, environment, path)),
  );

  server.tool(
    "graph_list_overlays",
    "List all overlays (config-based and runtime) for an environment.",
    { environment: z.string().describe("Environment name") },
    async ({ environment }) => json(handleListOverlays(manager, environment)),
  );

  server.tool(
    "graph_add_environment",
    "Register a new ephemeral environment pointing to an ADF artifact directory. Lost on server restart. Cannot collide with config-based environment names.",
    {
      name: z.string().describe("Environment name (cannot contain '+')"),
      path: z.string().describe("Path to ADF artifact root directory"),
      overlays: z.array(z.string()).optional().describe("Optional overlay paths to apply to this environment"),
      schemaPath: z.string().optional().describe("Optional path to Dataverse schema environment directory (contains per-entity JSON files)"),
    },
    async ({ name, path, overlays, schemaPath }) => json(handleAddEnvironment(manager, name, path, overlays, schemaPath)),
  );

  server.tool(
    "graph_remove_environment",
    "Remove a runtime environment. Config-based environments cannot be removed via this tool.",
    { name: z.string().describe("Environment name to remove") },
    async ({ name }) => json(handleRemoveEnvironment(manager, name)),
  );

  server.tool(
    "graph_generate_scope",
    "Generate a scope manifest by walking orchestrator pipeline trees. Collects all reachable pipelines, stored procedures, tables, and datasets. Optionally detects orphan pipelines in a specified ADF folder.",
    {
      roots: z.array(z.string()).optional().describe("Root orchestrator pipeline names. Defaults to the 3 W3 roots."),
      folder: z.string().optional().describe("ADF folder name to cross-check for orphan pipelines (e.g. 'Wave 3')"),
      environment: environmentParam,
    },
    async ({ roots, folder, environment }) => {
      const build = manager.ensureGraph(environment);
      const defaultRoots = [
        "onprem_NightlyOrganizationLoad_v2",
        "onprem_Orchestration_DeltaLoad",
        "onprem_Orchestration_Migration_Wave3",
      ];
      return json(handleGenerateScope(build.graph, {
        roots: roots ?? defaultRoots,
        folder,
      }));
    },
  );

  // ── CDC / filter analysis tools ──────────────────────────────────────

  server.tool(
    "graph_filter_chain",
    "Extract and display all WHERE/filter conditions across the pipeline chain for a given entity or table. Shows the complete filter path from source through staging to destination.",
    {
      entity: z.string().describe("Entity or table name to trace filters for (e.g. 'pcx_workpackage' or 'Work_Item')"),
      environment: environmentParam,
    },
    async ({ entity, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleFilterChain(build.graph, entity));
    },
  );

  server.tool(
    "graph_cdc_analysis",
    "Analyse CDC (Change Data Capture) pipeline configuration. Shows source CDC tables, staging tables (current/historical/pending), the full filter chain from source through staging to Dataverse, escape hatch conditions, and detects configuration gaps.",
    {
      pipeline: z.string().describe("Pipeline name (orchestrator or CDC child pipeline)"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleCdcAnalysis(build.graph, pipeline));
    },
  );

  server.tool(
    "graph_staging_population",
    "Cross-reference staging tables in a pipeline's dest_query. Maps which staging tables feed into the query, their expected role (CDC tracking, manual inclusion list, DV mirror), and how they are populated.",
    {
      pipeline: z.string().describe("Pipeline name"),
      environment: environmentParam,
    },
    async ({ pipeline, environment }) => {
      const build = manager.ensureGraph(environment);
      return json(handleStagingPopulation(build.graph, pipeline));
    },
  );
}
