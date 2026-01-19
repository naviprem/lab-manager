output "data_bucket" {
  description = "Name of the data lake bucket"
  value       = aws_s3_bucket.data.id
}

output "data_bucket_arn" {
  description = "ARN of the data lake bucket"
  value       = aws_s3_bucket.data.arn
}

output "logs_bucket" {
  description = "Name of the logs bucket"
  value       = aws_s3_bucket.logs.id
}

output "logs_bucket_arn" {
  description = "ARN of the logs bucket"
  value       = aws_s3_bucket.logs.arn
}
