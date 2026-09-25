import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { GraphManager } from "./graph/manager.js";
import { Graph } from "./graph/model.js";
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
import { handleDescribeStoredProcedure } from "./tools/describeStoredProcedure.js";
import { handleDescribeTable } from "./tools/describeTable.js";
import { handleDescribeTrigger } from "./tools/describeTrigger.js";
import { handleDescribeIntegrationRuntime } from "./tools/describeIntegrationRuntime.js";
import { handleEnvironmentConfig } from "./tools/environmentConfig.js";
import { handleSpBody } from "./tools/spBody.js";
import { buildBoomerangEnrich } from "./utils/boomerangRef.js";

const DEFAULT_SCOPE_ROOTS = [
  "onprem_NightlyOrganizationLoad_v2",
  "onprem_Orchestration_DeltaLoad",
  "onprem_Orchestration_Migration_Wave3",
];

const SEE_ALSO_NODE_TYPES = new Set(["stored_procedure", "table", "dataverse_entity"]);

const environmentParam = z
  .string()
  .optional()
  .describe("Environment name. If omitted, uses the default environment.");

const nodeTypeEnum = z.enum([
  "pipeline", "activity", "dataset", "stored_procedure", "table",
  "dataverse_entity", "dataverse_attribute", "linked_service", "key_vault_secret",
  "trigger", "integration_runtime",
]);

const summaryOrFull = (description: string) => z.enum(["summary", "full"]).default("summary").describe(description);
const pipelineParam = (description = "Pipeline name") => z.string().describe(description);

function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function errorResult(err: unknown) {
  return { ...json({ error: err instanceof Error ? err.message : String(err) }), isError: true };
}

interface EnvContext {
  envName: string;
  graph: Graph;
  warnings: string[];
  schemaPath: string | undefined;
  seeAlso(result: unknown, names: string[]): unknown;
}

export function registerTools(server: McpServer, manager: GraphManager): void {
  const tool = <S extends ZodRawShapeCompat>(
    name: string,
    description: string,
    shape: S,
    run: (args: ShapeOutput<S>) => unknown,
  ) =>
    server.tool(name, description, shape as ZodRawShapeCompat, async (args) => {
      try {
        return json(await run(args as ShapeOutput<S>));
      } catch (err) {
        return errorResult(err);
      }
    });

  const resolveEnv = (environment: string | undefined): EnvContext => {
    const build = manager.ensureGraph(environment);
    const envName = environment ?? manager.getDefaultEnvironment();
    return {
      envName,
      graph: build.graph,
      warnings: build.warnings,
      schemaPath: manager.getSchemaPath(envName),
      seeAlso: (result, names) =>
        names.length === 0 ? result : { ...(result as Record<string, unknown>), see_also: [buildBoomerangEnrich(names, envName)] },
    };
  };

  const envTool = <S extends ZodRawShapeCompat>(
    name: string,
    description: string,
    shape: S,
    run: (args: ShapeOutput<S>, ctx: EnvContext) => unknown,
  ) =>
    tool(name, description, { ...shape, environment: environmentParam }, (args) =>
      run(args as ShapeOutput<S>, resolveEnv((args as { environment?: string }).environment)),
    );

  envTool(
    "graph_stats",
    "Returns aggregate statistics about the ADF dependency graph (node/edge counts by type, build time, staleness).",
    {},
    (_, { envName, graph, warnings }) => {
      const envInfo = manager.listEnvironments().find((e) => e.name === envName);
      return handleStats(graph, envInfo?.lastBuild ?? null, envInfo?.isStale ?? true, warnings);
    },
  );

  envTool(
    "graph_export",
    "Export the full graph (all nodes and edges) as a single JSON payload. Designed for visualization tools that need the complete topology.",
    {},
    (_, { graph, envName }) => handleExport(graph, envName),
  );

  envTool(
    "graph_find_consumers",
    "Find all pipeline activities that consume a given dataset, table, stored procedure, or Dataverse entity.",
    {
      target: z.string().describe("Name of the target artifact (e.g. 'businessunit')"),
      target_type: nodeTypeEnum.describe("Node type of the target"),
    },
    ({ target, target_type }, { graph }) => handleFindConsumers(graph, target, target_type),
  );

  envTool(
    "graph_describe_pipeline",
    "Describe a pipeline: summary, activities, full detail, or resolved (inlines parameter values for child pipeline calls, detects CDC patterns). Optionally filter to a single named activity.",
    {
      pipeline: pipelineParam(),
      depth: z.enum(["summary", "activities", "full", "resolved"]).default("summary").describe("Level of detail. 'resolved' inlines parameter values for ExecutePipeline activities and detects CDC patterns."),
      activity: z.string().optional().describe("Optional activity name — returns full detail for just that activity"),
    },
    ({ pipeline, depth, activity }, { graph, seeAlso }) => {
      const result = handleDescribePipeline(graph, pipeline, depth, activity);
      const spNames = (result.activities ?? []).map((a) => a.storedProcedureName).filter(Boolean) as string[];
      return seeAlso(result, spNames);
    },
  );

  envTool(
    "graph_describe_entity",
    "Describe a Dataverse entity: metadata, attributes, and pipeline consumers. At 'full' depth, includes attribute types, required levels, and create/update flags from the schema file.",
    {
      entity: z.string().describe("Dataverse entity logical name (e.g. 'alm_organization')"),
      depth: summaryOrFull("'summary' = names only; 'full' = attribute types, required levels, create/update flags"),
    },
    ({ entity, depth }, { graph, schemaPath, seeAlso }) =>
      seeAlso(handleDescribeEntity(graph, entity, depth, schemaPath), [entity]),
  );

  envTool(
    "graph_impact_analysis",
    "Analyse which nodes are affected if a given artifact changes. Traverses upstream, downstream, or both.",
    {
      target: z.string().describe("Name of the artifact to analyse"),
      target_type: nodeTypeEnum.describe("Node type of the target"),
      direction: z.enum(["upstream", "downstream", "both"]).default("both").describe("Traversal direction"),
    },
    ({ target, target_type, direction }, { graph, seeAlso }) => {
      const result = handleImpactAnalysis(graph, target, target_type, direction);
      const names = (result.affected ?? []).filter((a) => SEE_ALSO_NODE_TYPES.has(a.nodeType)).map((a) => a.name);
      return seeAlso(result, names);
    },
  );

  envTool(
    "graph_data_lineage",
    "Trace data lineage for a Dataverse entity or staging table. Optionally filter to a single attribute/column.",
    {
      entity: z.string().describe("Entity or table name. Accepts bare name ('Org_Staging'), schema-qualified ('dbo.Org_Staging'), full node ID ('table:dbo.Org_Staging'), or Dataverse entity ('businessunit'). Case-insensitive."),
      attribute: z.string().optional().describe("Optional attribute/column name for column-level lineage"),
      direction: z.enum(["upstream", "downstream"]).describe("'upstream' = what feeds this node; 'downstream' = what this node feeds"),
      maxDepth: z.number().int().min(1).optional().describe("Maximum traversal depth (hops). Omit for unlimited."),
      detail: summaryOrFull("'summary' = unique nodes grouped by type; 'full' = complete paths"),
      nodeTypes: z.array(z.string()).optional().describe("Filter to these node types (e.g. ['table', 'dataverse_entity'])"),
      limit: z.number().int().min(1).optional().describe("Max paths to return (full mode only)"),
      offset: z.number().int().min(0).optional().describe("Paths to skip (full mode only)"),
    },
    ({ entity, attribute, direction, maxDepth, detail, nodeTypes, limit, offset }, { graph, seeAlso }) => {
      const result = handleDataLineage(graph, entity, { attribute, direction, maxDepth, detail, nodeTypes, limit, offset });
      const names = new Set<string>();
      if ("paths" in result) {
        for (const p of result.paths) {
          for (const s of p.steps) {
            if (SEE_ALSO_NODE_TYPES.has(s.nodeType)) names.add(s.name);
          }
        }
      }
      return seeAlso(result, [...names]);
    },
  );

  envTool(
    "graph_find_paths",
    "Find all dependency paths between two nodes in the graph.",
    {
      from: z.string().describe("Source node name"),
      to: z.string().describe("Target node name"),
      from_type: z.string().optional().describe("Node type of the source (e.g. 'pipeline')"),
      to_type: z.string().optional().describe("Node type of the target (e.g. 'dataverse_entity')"),
    },
    ({ from, to, from_type, to_type }, { graph }) => handleFindPaths(graph, from, to, from_type, to_type),
  );

  envTool(
    "graph_find_orchestrators",
    "Find root orchestrator pipelines that own a given pipeline. Returns full ancestry chains with depth.",
    { pipeline: pipelineParam("Pipeline name to trace ancestry for") },
    ({ pipeline }, { graph }) => handleFindOrchestrators(graph, pipeline),
  );

  envTool(
    "graph_search",
    "Flexible search across the graph: node names, activity SQL, FetchXML, stored procedure names/parameters, and ExecutePipeline parameter values. Supports filters for activity type, node type, target entity, and pipeline scope.",
    {
      query: z.string().min(1).describe("Search text (case-insensitive substring match)"),
      activityType: z.string().optional().describe("Filter to activities of this type (e.g. 'Copy', 'ExecutePipeline')"),
      nodeType: z.string().optional().describe("Filter to this node type (e.g. 'pipeline', 'dataset')"),
      targetEntity: z.string().optional().describe("Filter to activities that reference this entity/table"),
      pipeline: z.string().optional().describe("Filter to activities within this pipeline"),
      detail: z.enum(["summary", "full"]).default("summary").describe("Level of detail per hit"),
    },
    ({ query, ...filters }, { graph }) => handleEnhancedSearch(graph, query, filters),
  );

  envTool(
    "graph_trace_connection",
    "Trace the full connection chain from a pipeline's activities through datasets, linked services, and credentials. Returns serviceUri, servicePrincipalId, and Key Vault secret references for each connection.",
    {
      pipeline: pipelineParam("Pipeline name to trace connections for"),
      activity: z.string().optional().describe("Optional activity name — traces only that activity's connections"),
    },
    ({ pipeline, activity }, { graph, seeAlso }) => seeAlso(handleTraceConnection(graph, pipeline, activity), [pipeline]),
  );

  tool(
    "graph_diff_pipeline",
    "Compare a pipeline's structure across two environments. Shows added/removed/modified activities, SQL changes, and column mapping differences.",
    {
      pipeline: pipelineParam("Pipeline name to compare"),
      envA: z.string().describe("First environment name"),
      envB: z.string().describe("Second environment name"),
    },
    ({ pipeline, envA, envB }) =>
      handleDiffPipeline(manager.ensureGraph(envA).graph, manager.ensureGraph(envB).graph, pipeline, envA, envB),
  );

  tool(
    "graph_diff_environments",
    "Compare pipelines across two environments. Returns added/removed/changed pipelines with summary-level diffs.",
    {
      envA: z.string().describe("First environment name"),
      envB: z.string().describe("Second environment name"),
      scope: z.enum(["pipelines", "all"]).default("pipelines").describe("What to compare: pipelines only or all artifact types"),
    },
    ({ envA, envB, scope }) => handleDiffEnvironments(manager, envA, envB, scope),
  );

  tool(
    "graph_diff_staging",
    "Compare staged pipeline changes against the deployed version. Auto-detects staging and deployed environments from config, or accepts explicit environment names.",
    {
      pipeline: pipelineParam("Pipeline name to compare"),
      staging_env: z.string().optional().describe("Staging environment name (auto-detected if omitted)"),
      deployed_env: z.string().optional().describe("Deployed environment name (auto-detected if omitted)"),
    },
    ({ pipeline, staging_env, deployed_env }) => handleDiffStaging(manager, pipeline, staging_env, deployed_env),
  );

  tool(
    "graph_cross_env_artifact",
    "Compare a single artifact across all registered environments. Shows per-environment metadata with field-level diffs to spot configuration inconsistencies (e.g. different serviceUri across factories).",
    {
      name: z.string().describe("Artifact name (e.g. 'LS_ALMDATAVERSEUSER4_USGOVVA_01')"),
      artifact_type: z.enum(["pipeline", "dataset", "linked_service"]).describe("Type of artifact to compare"),
    },
    ({ name, artifact_type }) => handleCrossEnvArtifact(manager, name, artifact_type),
  );

  envTool(
    "graph_validate",
    "Run graph-wide validation: broken references, empty-default parameters without suppliers, unused datasets, orphaned nodes, cross-org Dataverse URI mismatches. Returns errors and warnings.",
    { severity: z.enum(["all", "error", "warning"]).default("all").describe("Filter by severity") },
    ({ severity }, { graph, envName, schemaPath }) => handleValidate(graph, envName, severity, schemaPath),
  );

  envTool(
    "graph_validate_pipeline",
    "Validate dest_query column aliases against Dataverse entity schema. Checks that each SQL alias maps to a valid entity attribute, flags invalid columns, and whitelists system attributes.",
    { pipeline: pipelineParam() },
    ({ pipeline }, { graph, schemaPath }) => handleValidatePipeline(graph, pipeline, schemaPath),
  );

  envTool(
    "graph_validate_statuscode",
    "Validate CASE WHEN values for statuscode/statecode columns in dest_query against Dataverse OptionSet metadata. Checks that integer values map to valid OptionSet options.",
    { pipeline: pipelineParam() },
    ({ pipeline }, { graph, schemaPath }) => handleValidateStatuscode(graph, pipeline, schemaPath),
  );

  envTool(
    "graph_find_bad_columns",
    "Bulk audit: scan all pipelines for dest_query parameters and report every column alias that does not match a Dataverse entity attribute.",
    {},
    (_, { graph, schemaPath }) => handleFindBadColumns(graph, schemaPath),
  );

  envTool(
    "graph_validate_staging_columns",
    "Validate source_query SELECT columns against staging table DDL. Detects column name mismatches that cause ADF auto-mapping failures at runtime. Warns when Copy activities use zero explicit mappings.",
    { pipeline: z.string().optional().describe("Pipeline name. If omitted, scans all pipelines.") },
    ({ pipeline }, { graph }) => handleValidateStagingColumns(graph, pipeline),
  );

  envTool(
    "graph_ignore_null_values_audit",
    "Scan all Copy activities writing to Dataverse and flag those with ignoreNullValues absent or false. This dangerous default causes NULL source columns to overwrite existing Dataverse values.",
    { detail: summaryOrFull("'summary' = per-pipeline counts; 'full' = every flagged activity") },
    ({ detail }, { graph }) => handleIgnoreNullValuesAudit(graph, detail),
  );

  envTool(
    "graph_staging_dependencies",
    "Map shared staging table usage across pipelines. Shows which pipelines read/write each table, flags shared tables where concurrent execution risks data corruption, and detects TRUNCATE TABLE patterns.",
    { table: z.string().optional().describe("Filter to tables matching this name (case-insensitive substring)") },
    ({ table }, { graph }) => handleStagingDependencies(graph, table),
  );

  envTool(
    "graph_entity_coverage",
    "Show all pipelines writing to a Dataverse entity with per-pipeline column lists. Highlights column differences across pipelines to detect mapping inconsistencies.",
    {
      entity: z.string().describe("Dataverse entity logical name (e.g. 'alm_workset')"),
      detail: summaryOrFull("'summary' = columns + frequency only; 'full' = per-pipeline coverage entries"),
    },
    ({ entity, detail }, { graph, seeAlso }) => seeAlso(handleEntityCoverage(graph, entity, detail), [entity]),
  );

  envTool(
    "graph_trace_parameters",
    "Trace parameter flow through ExecutePipeline chains from a root pipeline. Maps each parameter from source to sink and flags dead-ends: parameters with empty/null defaults that no caller supplies a value for.",
    { pipeline: pipelineParam("Root pipeline name to trace from") },
    ({ pipeline }, { graph }) => handleTraceParameters(graph, pipeline),
  );

  envTool(
    "graph_parameter_trace",
    "Trace parameter values from parent to child pipelines. For a given pipeline, show what each caller supplies for each parameter via ExecutePipeline activities. Flags dead-end parameters with no supplier.",
    {
      pipeline: pipelineParam("Pipeline name to inspect callers for"),
      parameter: z.string().optional().describe("Filter to a specific parameter name"),
    },
    ({ pipeline, parameter }, { graph }) => handleParameterCallers(graph, pipeline, parameter),
  );

  envTool(
    "graph_deploy_readiness",
    "Pre-flight check: walks the full dependency tree of a pipeline and reports what artifacts are present, stub (referenced but no file), or missing in the target environment. Also flags parameters with empty/null defaults that no parent supplies. Optionally compares linked service configuration against another environment.",
    {
      pipeline: pipelineParam("Root pipeline name to check"),
      compare_env: z.string().optional().describe("Optional environment name to compare linked service config against (flags serviceUri/credential differences)"),
    },
    ({ pipeline, compare_env }, { graph, schemaPath }) => {
      const compareGraph = compare_env ? manager.ensureGraph(compare_env).graph : undefined;
      return handleDeployReadiness(graph, pipeline, compareGraph, compare_env, schemaPath);
    },
  );

  tool(
    "graph_list_environments",
    "List all configured environments with their paths, default status, and graph statistics (node/edge counts, last build time, staleness).",
    {},
    () => manager.listEnvironments(),
  );

  tool(
    "graph_add_overlay",
    "Add an overlay path (directory or file) to an environment. The overlay's artifacts are merged on top of the base graph in a separate merged view. Runtime overlays are ephemeral (lost on restart).",
    {
      environment: z.string().describe("Base environment name to overlay onto"),
      path: z.string().describe("Path to overlay directory or file"),
    },
    ({ environment, path }) => handleAddOverlay(manager, environment, path),
  );

  tool(
    "graph_remove_overlay",
    "Remove a runtime overlay from an environment. Config-based overlays cannot be removed via this tool.",
    {
      environment: z.string().describe("Environment name"),
      path: z.string().describe("Overlay path to remove"),
    },
    ({ environment, path }) => handleRemoveOverlay(manager, environment, path),
  );

  tool(
    "graph_list_overlays",
    "List all overlays (config-based and runtime) for an environment.",
    { environment: z.string().describe("Environment name") },
    ({ environment }) => handleListOverlays(manager, environment),
  );

  tool(
    "graph_add_environment",
    "Register a new ephemeral environment pointing to an ADF artifact directory. Lost on server restart. Cannot collide with config-based environment names.",
    {
      name: z.string().describe("Environment name (cannot contain '+')"),
      path: z.string().describe("Path to ADF artifact root directory"),
      overlays: z.array(z.string()).optional().describe("Optional overlay paths to apply to this environment"),
      schemaPath: z.string().optional().describe("Optional path to Dataverse schema environment directory (contains per-entity JSON files)"),
    },
    ({ name, path, overlays, schemaPath }) => handleAddEnvironment(manager, name, path, overlays, schemaPath),
  );

  tool(
    "graph_remove_environment",
    "Remove a runtime environment. Config-based environments cannot be removed via this tool.",
    { name: z.string().describe("Environment name to remove") },
    ({ name }) => handleRemoveEnvironment(manager, name),
  );

  envTool(
    "graph_generate_scope",
    "Generate a scope manifest by walking orchestrator pipeline trees. Collects all reachable pipelines, stored procedures, tables, and datasets. Optionally detects orphan pipelines in a specified ADF folder.",
    {
      roots: z.array(z.string()).optional().describe("Root orchestrator pipeline names. Defaults to the environment's configured scopeRoots, else the 3 W3 roots."),
      folder: z.string().optional().describe("ADF folder name to cross-check for orphan pipelines (e.g. 'Wave 3')"),
    },
    ({ roots, folder }, { graph, envName }) =>
      handleGenerateScope(graph, { roots: roots ?? manager.getScopeRoots(envName) ?? DEFAULT_SCOPE_ROOTS, folder }),
  );

  envTool(
    "graph_filter_chain",
    "Extract and display all WHERE/filter conditions across the pipeline chain for a given entity or table. Shows the complete filter path from source through staging to destination.",
    { entity: z.string().describe("Entity or table name to trace filters for (e.g. 'pcx_workpackage' or 'Work_Item')") },
    ({ entity }, { graph }) => handleFilterChain(graph, entity),
  );

  envTool(
    "graph_cdc_analysis",
    "Analyse CDC (Change Data Capture) pipeline configuration. Shows source CDC tables, staging tables (current/historical/pending), the full filter chain from source through staging to Dataverse, escape hatch conditions, and detects configuration gaps.",
    { pipeline: pipelineParam("Pipeline name (orchestrator or CDC child pipeline)") },
    ({ pipeline }, { graph }) => handleCdcAnalysis(graph, pipeline),
  );

  envTool(
    "graph_staging_population",
    "Cross-reference staging tables in a pipeline's dest_query. Maps which staging tables feed into the query, their expected role (CDC tracking, manual inclusion list, DV mirror), and how they are populated.",
    { pipeline: pipelineParam() },
    ({ pipeline }, { graph }) => handleStagingPopulation(graph, pipeline),
  );

  envTool(
    "graph_describe_stored_procedure",
    "Return structured facts about a stored procedure: parameters, tables read/written, callers, confidence, and column mappings. Avoids reading .sql files directly.",
    {
      name: z.string().describe("Stored procedure name (e.g. 'p_Agenda_Commission_Meeting_Staging_Transform' or 'dbo.p_Agenda_Commission_Meeting_Staging_Transform')"),
      depth: summaryOrFull("'summary' = params, tables, callers; 'full' = adds column mappings and SQL body"),
    },
    ({ name, depth }, { graph, seeAlso }) => {
      const result = handleDescribeStoredProcedure(graph, name, depth);
      const names = [...(result.readTables ?? []), ...(result.writeTables ?? [])];
      if (!result.error) names.push(name);
      return seeAlso(result, names);
    },
  );

  envTool(
    "graph_describe_table",
    "Return a table's column schema (names, types, nullable) and its pipeline/SP consumers. Avoids reading DDL files directly.",
    { table: z.string().describe("Table name (e.g. 'Agenda_Commission_Meeting_Staging' or 'dbo.Agenda_Commission_Meeting_Staging')") },
    ({ table }, { graph, seeAlso }) => {
      const result = handleDescribeTable(graph, table);
      const names = (result.storedProcedureConsumers ?? []).map((c) => c.spName);
      if (!result.error) names.push(table);
      return seeAlso(result, names);
    },
  );

  envTool(
    "graph_describe_trigger",
    "Return trigger schedules, associated pipelines, and runtime state. If no trigger name is given, lists all triggers.",
    {
      trigger: z.string().optional().describe("Trigger name. If omitted, lists all triggers."),
      pipeline: z.string().optional().describe("Filter to triggers that fire this pipeline."),
    },
    ({ trigger, pipeline }, { graph }) => handleDescribeTrigger(graph, trigger, pipeline),
  );

  envTool(
    "graph_describe_integration_runtime",
    "Return integration runtime type, compute config, and which linked services use it. If no IR name is given, lists all IRs.",
    { ir: z.string().optional().describe("Integration runtime name. If omitted, lists all IRs.") },
    ({ ir }, { graph }) => handleDescribeIntegrationRuntime(graph, ir),
  );

  envTool(
    "graph_environment_config",
    "Return linked service endpoint configuration for a deployment target (e.g. 'uat', 'prod'). Resolves from config files or inline LS definitions relative to the environment path.",
    {
      target: z.string().describe("Deployment target name (e.g. 'uat', 'preprod', 'prod')"),
      linked_service: z.string().optional().describe("Filter to a specific linked service name"),
    },
    ({ target, linked_service }, { envName }) =>
      handleEnvironmentConfig(target, linked_service, manager.getEnvironmentPath(envName)),
  );

  envTool(
    "graph_sp_body",
    "Return the full SQL body of a stored procedure. Use this when you need the actual SQL content, not just metadata.",
    {
      name: z.string().describe("Stored procedure name (e.g. 'p_ADF_Batch_Processing' or 'dbo.p_ADF_Batch_Processing')"),
      schema: z.string().default("dbo").describe("Schema name (default 'dbo')"),
    },
    ({ name, schema }, { graph }) => handleSpBody(graph, name, schema),
  );
}
