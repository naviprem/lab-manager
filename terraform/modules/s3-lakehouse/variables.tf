variable "lab_name" {
  description = "Unique name for this lab environment"
  type        = string
}

variable "data_bucket_name" {
  description = "Name for the data lake bucket"
  type        = string
}

variable "logs_bucket_name" {
  description = "Name for the logs bucket"
  type        = string
}
