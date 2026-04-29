import { GraphManager } from "../graph/manager.js";
import { OVERLAY_SUFFIX } from "../constants.js";
import { handleDiffPipeline, PipelineDiffResult } from "./diff.js";

export interface DiffStagingResult {
  stagingEnv: string;
  deployedEnv: string;
  pipeline: string;
  diff: PipelineDiffResult;
  error?: string;
}

function autoDetectEnvironments(
  manager: GraphManager,
): { stagingEnv: string; deployedEnv: string } | { error: string } {
  const envs = manager.listEnvironments();
  const envNames = envs.map((e) => e.name);

  const overlayEnvs = envNames.filter((n) => n.endsWith(OVERLAY_SUFFIX));
  if (overlayEnvs.length === 1) {
    const base = overlayEnvs[0].replace(OVERLAY_SUFFIX, "");
    return { stagingEnv: overlayEnvs[0], deployedEnv: base };
  }

  const stagingCandidates = envNames.filter(
    (n) => /staging/i.test(n) || /work.*repo/i.test(n) || /branch/i.test(n)
  );
  const deployedCandidates = envNames.filter(
    (n) => /dev\d*$/i.test(n) || /export/i.test(n) || /deploy/i.test(n) || /prd/i.test(n) || /prod/i.test(n)
  );

  if (stagingCandidates.length === 1 && deployedCandidates.length === 1) {
    return { stagingEnv: stagingCandidates[0], deployedEnv: deployedCandidates[0] };
  }

  const defaultEnv = manager.getDefaultEnvironment();
  if (stagingCandidates.length === 1) {
    return { stagingEnv: stagingCandidates[0], deployedEnv: defaultEnv };
  }

  return {
    error: `Could not auto-detect staging/deployed environments. Available: [${envNames.join(", ")}]. Provide staging_env and deployed_env explicitly.`,
  };
}

export function handleDiffStaging(
  manager: GraphManager,
  pipeline: string,
  stagingEnv?: string,
  deployedEnv?: string,
): DiffStagingResult {
  let resolvedStaging: string;
  let resolvedDeployed: string;

  if (stagingEnv && deployedEnv) {
    resolvedStaging = stagingEnv;
    resolvedDeployed = deployedEnv;
  } else {
    const detected = autoDetectEnvironments(manager);
    if ("error" in detected) {
      return {
        stagingEnv: stagingEnv ?? "(unknown)",
        deployedEnv: deployedEnv ?? "(unknown)",
        pipeline,
        diff: {
          pipeline,
          envA: "(unknown)",
          envB: "(unknown)",
          summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
          activityDiffs: [],
        },
        error: detected.error,
      };
    }
    resolvedStaging = stagingEnv ?? detected.stagingEnv;
    resolvedDeployed = deployedEnv ?? detected.deployedEnv;
  }

  try {
    const buildStaging = manager.ensureGraph(resolvedStaging);
    const buildDeployed = manager.ensureGraph(resolvedDeployed);

    const diff = handleDiffPipeline(
      buildStaging.graph,
      buildDeployed.graph,
      pipeline,
      resolvedStaging,
      resolvedDeployed,
    );

    return {
      stagingEnv: resolvedStaging,
      deployedEnv: resolvedDeployed,
      pipeline,
      diff,
    };
  } catch (err) {
    return {
      stagingEnv: resolvedStaging,
      deployedEnv: resolvedDeployed,
      pipeline,
      diff: {
        pipeline,
        envA: resolvedStaging,
        envB: resolvedDeployed,
        summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
        activityDiffs: [],
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
