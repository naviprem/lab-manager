import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";

// Zod schemas for configuration validation
const LabConfigSchema = z.object({
  name: z.string(),
  environment: z.string().default("dev"),
});

const AWSConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  profile: z.string().optional(),
});

const TerraformConfigSchema = z.object({
  state_bucket: z.string(),
  state_lock_table: z.string(),
});

const AuroraConfigSchema = z.object({
  instance_class: z.string().default("db.t4g.medium"),
  min_capacity: z.number().default(0.5),
  max_capacity: z.number().default(2),
});

const S3ConfigSchema = z.object({
  data_bucket: z.string(),
  logs_bucket: z.string(),
});

const FoundationConfigSchema = z.object({
  vpc_cidr: z.string().default("10.0.0.0/16"),
  aurora: AuroraConfigSchema.default({}),
  s3: S3ConfigSchema.optional(),
});

const EKSConfigSchema = z.object({
  cluster_version: z.string().default("1.29"),
  instance_types: z.array(z.string()).default(["t3.medium"]),
  desired_size: z.number().default(2),
});

const EphemeralConfigSchema = z.object({
  eks: EKSConfigSchema.default({}),
});

const ConfigSchema = z.object({
  lab: LabConfigSchema,
  aws: AWSConfigSchema.default({}),
  terraform: TerraformConfigSchema.optional(),
  foundation: FoundationConfigSchema.default({}),
  ephemeral: EphemeralConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Interpolate ${var.path} patterns in configuration values
 */
function interpolate(data: unknown, variables: Record<string, string>): unknown {
  if (typeof data === "string") {
    return data.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      return variables[key] ?? `\${${key}}`;
    });
  }
  if (Array.isArray(data)) {
    return data.map((item) => interpolate(item, variables));
  }
  if (data && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = interpolate(value, variables);
    }
    return result;
  }
  return data;
}

/**
 * Extract flat variable dictionary for interpolation
 */
function extractVariables(obj: unknown, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};

  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.assign(result, extractVariables(value, newKey));
      } else {
        result[newKey] = String(value);
      }
    }
  }

  return result;
}

/**
 * Find project root by searching for lab.yaml
 */
export function getProjectRoot(): string {
  let current = process.cwd();

  while (current !== "/") {
    if (existsSync(resolve(current, "lab.yaml"))) {
      return current;
    }
    current = resolve(current, "..");
  }

  return process.cwd();
}

/**
 * Load and validate configuration from lab.yaml
 */
export function loadConfig(configPath?: string): Config {
  const projectRoot = getProjectRoot();
  const path = configPath ?? resolve(projectRoot, "lab.yaml");

  if (!existsSync(path)) {
    throw new Error(
      `Configuration file not found: ${path}\nCreate a lab.yaml file or copy lab.yaml.example`
    );
  }

  const content = readFileSync(path, "utf-8");
  const rawData = parse(content);

  // Extract variables and interpolate
  const variables = extractVariables(rawData);
  const interpolated = interpolate(rawData, variables);

  // Apply environment variable overrides
  if (process.env.LAB_AWS_REGION) {
    (interpolated as Record<string, unknown>).aws ??= {};
    (
      (interpolated as Record<string, unknown>).aws as Record<string, unknown>
    ).region = process.env.LAB_AWS_REGION;
  }

  return ConfigSchema.parse(interpolated);
}
