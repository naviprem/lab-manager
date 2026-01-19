# Ephemeral Module - Provisions the EKS Cluster
# This depends on the Foundation infrastructure being deployed

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend is generated dynamically by the CLI
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "lab-manager"
      Environment = var.environment
      ManagedBy   = "terraform"
      LabName     = var.lab_name
      Type        = "ephemeral"
    }
  }
}

# Data source to read foundation outputs
data "terraform_remote_state" "foundation" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "${var.lab_name}/foundation/terraform.tfstate"
    region = var.aws_region
  }
}

module "eks" {
  source = "../modules/eks"

  lab_name           = var.lab_name
  vpc_id             = data.terraform_remote_state.foundation.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.foundation.outputs.private_subnet_ids
  
  instance_types = var.eks_instance_types
  desired_size   = var.eks_desired_size
}

# IRSA (IAM Roles for Service Accounts) for S3 access
module "s3_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.lab_name}-s3-access"
  
  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["default:s3-sa", "spark:spark-sa", "trino:trino-sa"]
    }
  }

  role_policy_arns = {
    policy = data.terraform_remote_state.foundation.outputs.iam_policy_s3_arn
  }
}

# Add outputs for the CLI to use
output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "oidc_provider_arn" {
  value = module.eks.oidc_provider_arn
}
