output "s3_data_access_policy_arn" {
  description = "ARN of the S3 data access policy"
  value       = aws_iam_policy.s3_data_access.arn
}

output "s3_logs_access_policy_arn" {
  description = "ARN of the S3 logs access policy"
  value       = aws_iam_policy.s3_logs_access.arn
}

output "aurora_access_policy_arn" {
  description = "ARN of the Aurora access policy"
  value       = aws_iam_policy.aurora_access.arn
}

output "polaris_access_policy_arn" {
  description = "ARN of the Polaris access policy"
  value       = aws_iam_policy.polaris_access.arn
}
