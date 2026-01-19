# AWS Setup

## Check prerequisites

```bash
# Check AWS CLI Version
aws --version

# Chaeck Terraform version
terraform --version

# Check node version
node --version

# Check kubectl version
kubectl version --client

# Check helm version
helm version 
```

## Install Dependencies and Build

```bash
# Install project Dependencies
npm install

# Build the CLI Application
npm run build 

# Copy example config to lab.yaml
cp lab.yaml.example lab.yaml
```

## Configure AWS

```bash
# List AWS profiles
aws configure list-profiles

# Login to AWS
aws configure sso
aws sso login --profile naviprem-lab-profile

# Verify AWS profile authentication
aws sts get-caller-identity --profile naviprem-lab-profile 
```

## Run lab CLI

```bash
# Verify Lab CLI
npm run lab -- --help

# Run lab bootstrap to create persistent infrastructure
npm run lab -- bootstrap

# Or, to preview the changes
npm run lab -- bootstrap --dry-run


```

