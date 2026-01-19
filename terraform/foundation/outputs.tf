# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = module.vpc.private_subnet_ids
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = module.vpc.public_subnet_ids
}

# Aurora Outputs
output "aurora_cluster_endpoint" {
  description = "Writer endpoint for the Aurora cluster"
  value       = module.aurora.cluster_endpoint
}

output "aurora_cluster_reader_endpoint" {
  description = "Reader endpoint for the Aurora cluster"
  value       = module.aurora.cluster_reader_endpoint
}

output "aurora_security_group_id" {
  description = "ID of the Aurora security group"
  value       = module.aurora.security_group_id
}

output "aurora_secret_arn" {
  description = "ARN of the Secrets Manager secret containing Aurora credentials"
  value       = module.aurora.secret_arn
}

# S3 Outputs
output "data_bucket" {
  description = "Name of the data lake bucket"
  value       = module.s3.data_bucket
}

output "data_bucket_arn" {
  description = "ARN of the data lake bucket"
  value       = module.s3.data_bucket_arn
}

output "logs_bucket" {
  description = "Name of the logs bucket"
  value       = module.s3.logs_bucket
}

output "logs_bucket_arn" {
  description = "ARN of the logs bucket"
  value       = module.s3.logs_bucket_arn
}

# IAM Outputs
output "polaris_access_policy_arn" {
  description = "ARN of the Polaris access policy"
  value       = module.iam.polaris_access_policy_arn
}

output "s3_data_access_policy_arn" {
  description = "ARN of the S3 data access policy"
  value       = module.iam.s3_data_access_policy_arn
}
