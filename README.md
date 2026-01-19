# Lab Manager - Cloud-Native Lakehouse Laboratory

A command-line tool for provisioning and managing ephemeral cloud-native data lakehouse environments on AWS EKS, featuring Apache Iceberg, Trino, Spark, Polaris, and Keycloak.

## Overview

Lab Manager automates the deployment of a complete modern data lakehouse stack with:

- **Ephemeral Compute**: EKS cluster that can be spun up/down on demand
- **Persistent Data**: Aurora PostgreSQL for metadata, S3 for Iceberg tables
- **Identity & Access**: Keycloak for authentication, OPA for fine-grained authorization
- **Query Engines**: Trino for interactive SQL, Spark for batch processing
- **Catalog**: Apache Polaris REST catalog for Iceberg tables
- **Governance**: Row-level security, column masking, and table access policies

## Quick Start

### Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured (`aws configure`)
- Terraform >= 1.5
- Node.js >= 18
- kubectl >= 1.34
- Helm >= 3.12
- PostgreSQL client (psql) - optional for database operations

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd lab-manager

# Install dependencies
npm install

# Build the CLI
npm run build

# Link for global usage (optional)
npm link
```

### Create Lab Configuration

```bash
# Copy the example configuration
cp lab.yaml.example lab.yaml

# Edit with your settings
nano lab.yaml
```

Example `lab.yaml`:

```yaml
lab:
  name: my-lakehouse-lab
  environment: dev

aws:
  region: us-east-1
  profile: default  # optional

foundation:
  vpc_cidr: 10.0.0.0/16
  aurora:
    instance_class: db.t4g.medium

ephemeral:
  eks:
    instance_types: ["t3.medium"]
    desired_size: 2
```

### Deploy Your Lab

```bash
# Step 1: Bootstrap persistent infrastructure (VPC, Aurora, S3)
lab bootstrap

# Step 2: Deploy EKS cluster and core components
lab up

# Step 3: Check status
lab status

# Step 4: Seed with sample data (optional)
lab seed
```

### Teardown

```bash
# Destroy EKS cluster (keeps Aurora and S3 data)
lab down

# Destroy everything including data (DANGEROUS)
lab down --destroy-foundation
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS EKS Cluster                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Keycloak │──│ Polaris  │──│  Trino   │             │
│  │ (Auth)   │  │ (Catalog)│  │  (SQL)   │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
│       │             │              │                    │
│       │        ┌────┴─────┐   ┌───┴────┐              │
│       │        │  Spark   │   │  OPA   │              │
│       │        │ Operator │   │(Policy)│              │
│       │        └──────────┘   └────────┘              │
└───────┼─────────────┼──────────────────────────────────┘
        │             │
        ▼             ▼
  ┌──────────────────────┐      ┌──────────────┐
  │ Aurora PostgreSQL    │      │      S3      │
  │ (Metadata Storage)   │      │  (Iceberg)   │
  └──────────────────────┘      └──────────────┘
```

## Commands

### `lab bootstrap`

Provisions persistent AWS infrastructure that survives cluster teardowns.

**What it creates**:
- VPC with public/private subnets
- Aurora PostgreSQL cluster
- S3 buckets (data, logs)
- IAM roles and policies
- Terraform state backend

**Options**:
- `--dry-run` - Run terraform plan only
- `--skip-foundation` - Only create state backend
- `-f, --force` - Force re-run

**Example**:
```bash
lab bootstrap
```

### `lab up [components...]`

Deploys EKS cluster and specified components.

**Default components** (no args): Keycloak + Polaris
**Available components**: keycloak, polaris, trino, spark, opa

**Examples**:
```bash
lab up                    # Deploy core (EKS + Keycloak + Polaris)
lab up trino              # Add Trino
lab up trino spark opa    # Add multiple components
lab up --all              # Deploy everything
```

**Options**:
- `--dry-run` - Terraform plan only
- `--all` - Deploy all components
- `-f, --force` - Force re-deployment
- `--skip-essentials` - Skip namespace/secret creation
- `--skip-components` - Only provision EKS

### `lab down`

Tears down the EKS cluster while preserving Aurora and S3 data.

**Options**:
- `-f, --force` - Skip confirmation
- `--destroy-foundation` - Also destroy Aurora/S3 (DANGEROUS)

**Example**:
```bash
lab down
```

### `lab seed`

Provides instructions for populating sample data.

**Options**:
- `--tables-only` - Only seed tables
- `--users-only` - Only reset users
- `--skip-users` - Don't reset users
- `--rows <n>` - Number of rows

### `lab status`

Shows current deployment status including all components.

## Components

### Keycloak (Identity Provider)

**What it provides**:
- Pre-configured realm: `lab-realm`
- Sample users with different roles
- OIDC clients for other components

**Default Users**:
| Username | Password | Role | Access |
|----------|----------|------|--------|
| admin | admin123 | admin | Full access |
| analyst | analyst123 | data-analyst | Read-only, filtered data |
| engineer | engineer123 | data-engineer | Read/write, no PII |

**Access Admin Console**:
```bash
# Get URL
kubectl get svc -n keycloak keycloak

# Login with admin/admin123
```

### Polaris (Iceberg Catalog)

**What it provides**:
- REST API catalog for Iceberg tables
- Metadata stored in Aurora PostgreSQL
- S3 storage for table data
- OIDC authentication

**API Endpoint**:
```bash
kubectl get svc -n polaris polaris
# http://<url>:8181/api/catalog/v1
```

### Trino (SQL Query Engine)

**What it provides**:
- Distributed SQL queries over Iceberg
- 1 coordinator + 2 workers
- Web UI for query management
- Iceberg connector to Polaris

**Connect via JDBC**:
```
jdbc:trino://<trino-url>:8080/iceberg
```

**Example Queries**:
```sql
SHOW CATALOGS;
SHOW SCHEMAS IN iceberg;
SELECT * FROM iceberg.sales.transactions LIMIT 10;
```

### Spark (Batch Processing)

**What it provides**:
- Spark Operator for Kubernetes
- SparkApplication CRD
- Iceberg integration
- S3 access via IRSA

**Submit Jobs**:
```bash
kubectl apply -f .lab/examples/spark-iceberg-example.yaml
kubectl get sparkapplications -n spark
```

### OPA (Policy Engine)

**What it provides**:
- Fine-grained authorization
- Row-level security
- Column masking
- Table access control

**Sample Policies**:
1. **Row-level**: Analysts see only their department's data
2. **Column masking**: Hide PII (SSN, email, phone) from non-admins
3. **Table access**: Restrict sensitive schemas (HR, Finance)

## Use Case Demos

### Demo 1: Row-Level Security

```sql
-- Login as analyst@lab.local (department: Sales)
-- OPA automatically adds: WHERE department = 'Sales'

SELECT * FROM iceberg.sales.transactions;
-- Only sees Sales department data
```

### Demo 2: Column Masking

```sql
-- Login as engineer@lab.local

SELECT employee_id, name, ssn, email
FROM iceberg.hr.employees;

-- Result shows:
-- ssn: '***MASKED***'
-- email: '***MASKED***'
```

### Demo 3: Table Access Control

```sql
-- Login as analyst@lab.local

SELECT * FROM iceberg.hr.salaries;
-- Error: Access Denied (sensitive table)
```

## Configuration

### Lab Configuration File

Full configuration options in `lab.yaml`:

```yaml
lab:
  name: my-lab              # Used for resource naming
  environment: dev          # Environment tag

aws:
  region: us-east-1
  profile: default          # AWS CLI profile

foundation:
  vpc_cidr: 10.0.0.0/16
  aurora:
    instance_class: db.t4g.medium
    min_capacity: 0.5
    max_capacity: 2

ephemeral:
  eks:
    cluster_version: "1.29"
    instance_types: ["t3.medium"]
    desired_size: 2
```

### State Management

State is tracked in `.lab/state.json`:
- Component deployment status
- Terraform outputs
- Cluster configuration
- Resource URLs

## Troubleshooting

### Common Issues

**Component deployment timeout**:
```bash
# Check pod status
kubectl get pods -n <namespace>

# View logs
kubectl logs -n <namespace> <pod-name>

# Force re-deploy
lab up <component> --force
```

**Kubeconfig not configured**:
```bash
aws eks update-kubeconfig --name <cluster-name> --region <region>
```

**Terraform state conflicts**:
```bash
# Re-initialize
rm -rf terraform/*/.terraform
lab bootstrap --force
```

### Debug Commands

```bash
# Component logs
kubectl logs -n keycloak -l app.kubernetes.io/name=keycloak
kubectl logs -n trino -l component=coordinator
kubectl logs -n opa -l app=opa

# Component status
kubectl get pods -n <namespace>
kubectl describe pod -n <namespace> <pod-name>

# Service endpoints
kubectl get svc --all-namespaces
```

## Cost Estimation

### Persistent Resources (24/7)
- Aurora PostgreSQL (db.t4g.medium): ~$90/month
- S3 storage (100GB): ~$2.30/month
- NAT Gateway: ~$32/month
- **Total**: ~$125/month

### Ephemeral Resources (When Running)
- EKS control plane: $0.10/hour
- EC2 instances (2x t3.medium): ~$0.083/hour each
- Load Balancers: ~$0.025/hour each
- **Total**: ~$0.30/hour or ~$220/month if running 24/7

### Cost Optimization
- Run `lab down` when not using the lab
- Use Spot instances (configure in Terraform)
- Consider Aurora Serverless v2

## Security

- Secrets stored in AWS Secrets Manager
- IRSA (IAM Roles for Service Accounts) for AWS access
- Keycloak for centralized authentication
- OPA for fine-grained authorization
- Encrypted Aurora and S3
- Private subnets for data plane

## Project Structure

```
lab-manager/
├── src/
│   ├── commands/      # CLI command implementations
│   ├── components/    # Component deployment modules
│   ├── utils/         # Utilities (helm, kubectl, aws, etc.)
│   ├── helm/          # Helm values templates
│   ├── config/        # Configuration files and policies
│   └── manifests/     # Kubernetes manifests
├── terraform/         # Terraform modules
│   ├── bootstrap/     # State backend
│   ├── foundation/    # VPC, Aurora, S3
│   └── ephemeral/     # EKS cluster
├── impl-docs/         # Implementation documentation
└── package.json
```

## Development

```bash
# Development mode
npm run dev -- <command>

# Build
npm run build

# Run tests (dry-run)
lab up --dry-run
```

## Known Limitations

- Single-region deployment
- Manual IRSA role creation required
- No automated backup/restore (use AWS Backup)
- No multi-tenancy
- Polaris Helm chart may not be officially available

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[Specify your license]

## Documentation

- [Implementation Plans](impl-docs/) - Detailed phase-by-phase plans
- [Troubleshooting Guide](impl-docs/TROUBLESHOOTING.md)
- [Cost Estimation](impl-docs/COST_ESTIMATION.md)

## Support

- GitHub Issues: [Create an issue]
- Documentation: See `impl-docs/` directory
