variable "lab_name" {
  description = "Unique name for this lab environment"
  type        = string
}

variable "data_bucket_arn" {
  description = "ARN of the data lake bucket"
  type        = string
}

variable "logs_bucket_arn" {
  description = "ARN of the logs bucket"
  type        = string
}

variable "aurora_cluster_id" {
  description = "ID of the Aurora cluster"
  type        = string
}

variable "aurora_secret_arn" {
  description = "ARN of the Aurora credentials secret"
  type        = string
}
