# Contributing to Lab Manager

Thank you for your interest in contributing to Lab Manager! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js >= 18
- TypeScript
- AWS Account (for testing)
- Terraform >= 1.5
- kubectl >= 1.28
- Helm >= 3.12

### Local Development

```bash
# Clone the repository
git clone <repo-url>
cd lab-manager

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev -- <command>
```

## Project Structure

```
lab-manager/
├── src/
│   ├── cli.ts              # CLI entry point with Commander.js
│   ├── config.ts           # Configuration loading and validation
│   ├── state.ts            # State management
│   ├── terraform.ts        # Terraform wrapper functions
│   ├── commands/           # CLI command implementations
│   │   ├── bootstrap.ts    # Bootstrap command
│   │   ├── up.ts           # Up command with component deployment
│   │   ├── down.ts         # Down command with cleanup
│   │   └── seed.ts         # Seed command
│   ├── components/         # Component-specific deployment logic
│   │   ├── keycloak.ts     # Keycloak deployment
│   │   ├── polaris.ts      # Polaris deployment
│   │   ├── trino.ts        # Trino deployment
│   │   ├── spark.ts        # Spark Operator deployment
│   │   └── opa.ts          # OPA deployment
│   ├── utils/              # Utility modules
│   │   ├── helm.ts         # Helm operations
│   │   ├── kubernetes.ts   # Kubectl operations
│   │   ├── aws.ts          # AWS CLI wrappers
│   │   ├── database.ts     # Aurora PostgreSQL operations
│   │   └── prompts.ts      # User interaction prompts
│   ├── helm/               # Helm values templates
│   ├── config/             # Configuration files
│   │   ├── keycloak-realm.json
│   │   └── policies/       # OPA Rego policies
│   └── manifests/          # Kubernetes manifests
├── terraform/              # Terraform modules
│   ├── bootstrap/          # State backend creation
│   ├── foundation/         # VPC, Aurora, S3
│   └── ephemeral/          # EKS cluster
└── impl-docs/              # Implementation documentation
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Provide type annotations for function parameters and return types
- Use interfaces for complex types
- Follow existing naming conventions:
  - PascalCase for classes and interfaces
  - camelCase for variables and functions
  - SCREAMING_SNAKE_CASE for constants

### Style Guide

- 2 spaces for indentation
- Single quotes for strings
- Semicolons required
- Max line length: 100 characters (flexible)
- Use async/await over promises

Example:

```typescript
export async function deployComponent(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  // Implementation
}
```

### Error Handling

- Use try-catch blocks for async operations
- Provide meaningful error messages
- Use chalk for colored console output
- Exit with code 1 on errors

Example:

```typescript
try {
  await helm.installChart(...);
  console.log(chalk.green("✓ Chart installed"));
} catch (error) {
  console.error(chalk.red(`Failed: ${(error as Error).message}`));
  throw error;
}
```

### User Messages

- Use chalk for consistent formatting:
  - `chalk.blue()` - Section headers and progress
  - `chalk.green()` - Success messages
  - `chalk.yellow()` - Warnings
  - `chalk.red()` - Errors
  - `chalk.dim()` - Supplementary info

- Use structured output with separators:
```typescript
console.log(chalk.blue("\n═══ Section Title ═══\n"));
```

## Adding New Components

### 1. Create Component Module

Create `src/components/newcomponent.ts`:

```typescript
import { Config } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import * as helm from "../utils/helm.js";

const NAMESPACE = "newcomponent";
const RELEASE = "newcomponent";

export async function deployNewComponent(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  // Check dependencies
  if (!state.components?.dependency?.deployed) {
    throw new Error("Dependency must be deployed first");
  }

  // Check if already deployed
  const exists = await helm.releaseExists(RELEASE, NAMESPACE);
  if (exists && !force) {
    return { deployed: true, namespace: NAMESPACE, release_name: RELEASE };
  }

  // Deploy via Helm
  await helm.installChart(RELEASE, "repo/chart", NAMESPACE);

  return {
    deployed: true,
    namespace: NAMESPACE,
    release_name: RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

export async function undeployNewComponent(): Promise<void> {
  await helm.uninstallChart(RELEASE, NAMESPACE);
}
```

### 2. Create Helm Values Template

Create `src/helm/newcomponent-values.yaml.template`:

```yaml
# Component Helm values
replicas: 1

image:
  repository: newcomponent/image
  tag: latest

service:
  type: ClusterIP
  port: 8080

resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "200m"
```

### 3. Integrate into Commands

Update `src/commands/up.ts`:

```typescript
import * as newcomponent from "../components/newcomponent.js";

// Add to available components
const availableComponents = [..., "newcomponent"];

// Add deployment logic
if (componentsToDeploy.includes("newcomponent")) {
  const componentState = await newcomponent.deployNewComponent(config, state, force);
  state = updateComponentState(state, "newcomponent", componentState);
}
```

Update `src/commands/down.ts`:

```typescript
if (components.newcomponent?.deployed) {
  await newcomponent.undeployNewComponent();
  clearComponentState(state, "newcomponent");
}
```

### 4. Update State Interface

Update `src/state.ts`:

```typescript
export interface LabState {
  // ...
  components: {
    // ...
    newcomponent?: ComponentState;
  };
}
```

## Testing

### Manual Testing

```bash
# Dry run
npm run dev -- up --dry-run

# Test component deployment
npm run dev -- up newcomponent

# Check status
npm run dev -- status

# Clean up
npm run dev -- down
```

### Testing Checklist

- [ ] Component deploys successfully
- [ ] Idempotent (re-running doesn't fail)
- [ ] State is updated correctly
- [ ] `lab status` shows component
- [ ] `lab down` cleans up properly
- [ ] Error messages are clear
- [ ] Dependencies are validated

## Documentation

### Code Comments

- Add JSDoc comments for public functions
- Explain complex logic with inline comments
- Keep comments up-to-date with code

Example:

```typescript
/**
 * Deploys the component via Helm
 *
 * @param config - Lab configuration
 * @param state - Current lab state
 * @param force - Force re-deployment
 * @returns Component state after deployment
 */
export async function deployComponent(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  // Implementation
}
```

### Documentation Updates

When adding features:
- Update README.md with usage examples
- Add implementation plan in `impl-docs/`
- Update command help text in `src/cli.ts`

## Pull Request Process

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the coding standards
3. **Test thoroughly** using the testing checklist
4. **Update documentation** as needed
5. **Commit with clear messages**:
   ```
   feat: add newcomponent deployment

   - Implements newcomponent via Helm
   - Adds integration with existing components
   - Updates documentation
   ```
6. **Submit a pull request** with:
   - Description of changes
   - Testing performed
   - Screenshots if applicable

## Commit Message Format

Follow conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

## Release Process

(To be defined based on project needs)

## Getting Help

- GitHub Discussions: Ask questions
- GitHub Issues: Report bugs or request features
- Documentation: Check `impl-docs/` directory

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

Thank you for contributing! 🎉
