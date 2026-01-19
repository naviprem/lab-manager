import { execa } from "execa";
import chalk from "chalk";

export class HelmError extends Error {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(`Helm command failed: ${command}`);
    this.name = "HelmError";
  }
}

/**
 * Check if Helm is installed
 */
export async function checkHelmInstalled(): Promise<boolean> {
  try {
    await execa("helm", ["version", "--short"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a Helm repository
 */
export async function addHelmRepo(name: string, url: string): Promise<void> {
  console.log(chalk.blue(`Adding Helm repository: ${name}`));

  try {
    await execa("helm", ["repo", "add", name, url], { stdio: "pipe" });
    console.log(chalk.green(`✓ Helm repo added: ${name}`));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";

    // Already exists is OK
    if (stderr.includes("already exists")) {
      console.log(chalk.dim(`Helm repo already exists: ${name}`));
    } else {
      const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
      throw new HelmError("repo add", exitCode, stderr);
    }
  }
}

/**
 * Update Helm repositories
 */
export async function updateHelmRepos(): Promise<void> {
  console.log(chalk.blue("Updating Helm repositories..."));

  try {
    await execa("helm", ["repo", "update"], { stdio: "pipe" });
    console.log(chalk.green("✓ Helm repos updated"));
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new HelmError(
      "repo update",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Install or upgrade a Helm chart
 */
export async function installChart(
  releaseName: string,
  chart: string,
  namespace: string,
  valuesFile?: string,
  wait = true,
  timeout = "10m"
): Promise<void> {
  console.log(chalk.blue(`Installing Helm chart: ${chart} as ${releaseName}`));

  const args = [
    "upgrade",
    "--install",
    releaseName,
    chart,
    "--namespace",
    namespace,
    "--create-namespace",
  ];

  if (valuesFile) {
    args.push("--values", valuesFile);
  }

  if (wait) {
    args.push("--wait", "--timeout", timeout);
  }

  try {
    await execa("helm", args, { stdio: "inherit" });
    console.log(chalk.green(`✓ Helm chart installed: ${releaseName}`));
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new HelmError(
      "upgrade --install",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Uninstall a Helm chart
 */
export async function uninstallChart(
  releaseName: string,
  namespace: string
): Promise<void> {
  console.log(chalk.blue(`Uninstalling Helm chart: ${releaseName}`));

  try {
    await execa("helm", ["uninstall", releaseName, "--namespace", namespace], {
      stdio: "pipe",
    });
    console.log(chalk.green(`✓ Helm chart uninstalled: ${releaseName}`));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";

    // Not found is OK during cleanup
    if (stderr.includes("not found")) {
      console.log(chalk.dim(`Helm release not found: ${releaseName}`));
    } else {
      const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
      throw new HelmError("uninstall", exitCode, stderr);
    }
  }
}

/**
 * List Helm releases in a namespace
 */
export async function listReleases(
  namespace?: string
): Promise<Array<{ name: string; namespace: string; status: string }>> {
  const args = ["list", "--output", "json"];

  if (namespace) {
    args.push("--namespace", namespace);
  } else {
    args.push("--all-namespaces");
  }

  try {
    const { stdout } = await execa("helm", args, { stdio: "pipe" });
    return JSON.parse(stdout);
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new HelmError(
      "list",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Get Helm release status
 */
export async function getRelease(
  releaseName: string,
  namespace: string
): Promise<{ status: string; version: number } | null> {
  try {
    const { stdout } = await execa(
      "helm",
      ["status", releaseName, "--namespace", namespace, "--output", "json"],
      { stdio: "pipe" }
    );

    const data = JSON.parse(stdout);
    return {
      status: data.info?.status,
      version: data.version,
    };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";

    if (stderr.includes("not found")) {
      return null;
    }

    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new HelmError(
      "status",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Check if a Helm release exists
 */
export async function releaseExists(
  releaseName: string,
  namespace: string
): Promise<boolean> {
  const release = await getRelease(releaseName, namespace);
  return release !== null;
}
