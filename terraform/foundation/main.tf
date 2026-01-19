# Foundation Module - Orchestrates all persistent infrastructure
# Backend configuration is generated dynamically by the CLI

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "lab-manager"
      Environment = var.environment
      ManagedBy   = "terraform"
      LabName     = var.lab_name
    }
  }
}

# VPC Module
module "vpc" {
  source = "../modules/vpc"

  lab_name = var.lab_name
  vpc_cidr = var.vpc_cidr
}

# Aurora Module
module "aurora" {
  source = "../modules/aurora"

  lab_name           = var.lab_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = module.vpc.vpc_cidr
  private_subnet_ids = module.vpc.private_subnet_ids
  min_capacity       = var.aurora_min_capacity
  max_capacity       = var.aurora_max_capacity
}

# S3 Lakehouse Module
module "s3" {
  source = "../modules/s3-lakehouse"

  lab_name         = var.lab_name
  data_bucket_name = var.data_bucket_name
  logs_bucket_name = var.logs_bucket_name
}

# IAM Base Module
module "iam" {
  source = "../modules/iam-base"

  lab_name          = var.lab_name
  data_bucket_arn   = module.s3.data_bucket_arn
  logs_bucket_arn   = module.s3.logs_bucket_arn
  aurora_cluster_id = module.aurora.cluster_id
  aurora_secret_arn = module.aurora.secret_arn
}
