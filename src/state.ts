import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getProjectRoot } from "./config.js";

export interface BootstrapOutputs {
  state_bucket: string;
  state_lock_table: string;
}

export interface FoundationOutputs {
  vpc_id: string;
  private_subnet_ids: string[];
  public_subnet_ids: string[];
  aurora_cluster_endpoint: string;
  aurora_cluster_reader_endpoint: string;
  aurora_security_group_id: string;
  aurora_secret_arn: string;
  iam_policy_s3_arn: string;
  data_bucket: string;
  data_bucket_arn: string;
  logs_bucket: string;
  logs_bucket_arn: string;
}

export interface EksOutputs {
  cluster_name: string;
  cluster_endpoint: string;
  oidc_provider_arn: string;
}

export interface ComponentState {
  deployed: boolean;
  version?: string;
  namespace?: string;
  release_name?: string;
  deployed_at?: string;
}

export interface LabState {
  version: string;
  lab_name: string;
  created_at: string;
  updated_at: string;
  bootstrapped: boolean;
  bootstrap_outputs?: BootstrapOutputs;
  foundation_deployed: boolean;
  foundation_outputs?: FoundationOutputs;
  eks_deployed: boolean;
  eks_outputs?: EksOutputs;
  cluster_ready?: boolean;
  cluster_context?: string;
  essentials_deployed?: boolean;
  components: {
    keycloak?: ComponentState;
    polaris?: ComponentState;
    trino?: ComponentState;
    spark?: ComponentState;
    opa?: ComponentState;
  };
}

function getStateDir(): string {
  const dir = resolve(getProjectRoot(), ".lab");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getStateFile(): string {
  return resolve(getStateDir(), "state.json");
}

/**
 * Load lab state from disk, or create new state if not found
 */
export function loadState(labName: string): LabState {
  const stateFile = getStateFile();

  if (existsSync(stateFile)) {
    const content = readFileSync(stateFile, "utf-8");
    return JSON.parse(content);
  }

  return {
    version: "1",
    lab_name: labName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    bootstrapped: false,
    foundation_deployed: false,
    eks_deployed: false,
    components: {},
  };
}

/**
 * Save lab state to disk
 */
export function saveState(state: LabState): void {
  state.updated_at = new Date().toISOString();
  const stateFile = getStateFile();
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/**
 * Update state with bootstrap outputs
 */
export function updateBootstrapState(
  state: LabState,
  outputs: Record<string, { value: unknown }>
): LabState {
  state.bootstrapped = true;
  state.bootstrap_outputs = {
    state_bucket: outputs.state_bucket.value as string,
    state_lock_table: outputs.state_lock_table.value as string,
  };
  saveState(state);
  return state;
}

/**
 * Update state with foundation outputs
 */
export function updateFoundationState(
  state: LabState,
  outputs: Record<string, { value: unknown }>
): LabState {
  state.foundation_deployed = true;
  state.foundation_outputs = {
    vpc_id: outputs.vpc_id.value as string,
    private_subnet_ids: outputs.private_subnet_ids.value as string[],
    public_subnet_ids: outputs.public_subnet_ids.value as string[],
    aurora_cluster_endpoint: outputs.aurora_cluster_endpoint.value as string,
    aurora_cluster_reader_endpoint: outputs.aurora_cluster_reader_endpoint.value as string,
    aurora_security_group_id: outputs.aurora_security_group_id.value as string,
    aurora_secret_arn: outputs.aurora_secret_arn.value as string,
    iam_policy_s3_arn: outputs.iam_policy_s3_arn.value as string,
    data_bucket: outputs.data_bucket.value as string,
    data_bucket_arn: outputs.data_bucket_arn.value as string,
    logs_bucket: outputs.logs_bucket.value as string,
    logs_bucket_arn: outputs.logs_bucket_arn.value as string,
  };
  saveState(state);
  return state;
}

/**
 * Update state with EKS outputs
 */
export function updateEksState(
  state: LabState,
  outputs: Record<string, { value: unknown }>
): LabState {
  state.eks_deployed = true;
  state.eks_outputs = {
    cluster_name: outputs.cluster_name.value as string,
    cluster_endpoint: outputs.cluster_endpoint.value as string,
    oidc_provider_arn: outputs.oidc_provider_arn.value as string,
  };
  saveState(state);
  return state;
}

/**
 * Update state with cluster readiness information
 */
export function updateClusterReadyState(
  state: LabState,
  contextName: string,
  essentialsDeployed: boolean
): LabState {
  state.cluster_ready = true;
  state.cluster_context = contextName;
  state.essentials_deployed = essentialsDeployed;
  saveState(state);
  return state;
}

/**
 * Clear ephemeral state (EKS and cluster info)
 */
export function clearEphemeralState(state: LabState): LabState {
  state.eks_deployed = false;
  state.eks_outputs = undefined;
  state.cluster_ready = false;
  state.cluster_context = undefined;
  state.essentials_deployed = false;
  saveState(state);
  return state;
}

/**
 * Update state with component deployment info
 */
export function updateComponentState(
  state: LabState,
  component: keyof LabState["components"],
  componentState: ComponentState
): LabState {
  state.components[component] = componentState;
  saveState(state);
  return state;
}

/**
 * Clear a component from state
 */
export function clearComponentState(
  state: LabState,
  component: keyof LabState["components"]
): LabState {
  delete state.components[component];
  saveState(state);
  return state;
}
