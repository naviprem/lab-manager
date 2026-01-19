# Aurora PostgreSQL Module - Serverless v2 cluster for metadata

# Random password for master user
resource "random_password" "master" {
  length  = 32
  special = false
}

# Store credentials in Secrets Manager
resource "aws_secretsmanager_secret" "aurora" {
  name                    = "${var.lab_name}/aurora/master"
  recovery_window_in_days = 0 # Allow immediate deletion for dev

  tags = {
    Name = "${var.lab_name}-aurora-secret"
  }
}

resource "aws_secretsmanager_secret_version" "aurora" {
  secret_id = aws_secretsmanager_secret.aurora.id
  secret_string = jsonencode({
    username = "labadmin"
    password = random_password.master.result
    host     = aws_rds_cluster.main.endpoint
    port     = 5432
    dbname   = "postgres"
  })
}

# Subnet Group for Aurora
resource "aws_db_subnet_group" "aurora" {
  name        = "${var.lab_name}-aurora"
  description = "Subnet group for Aurora cluster"
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name = "${var.lab_name}-aurora-subnet-group"
  }
}

# Security Group for Aurora
resource "aws_security_group" "aurora" {
  name        = "${var.lab_name}-aurora"
  description = "Security group for Aurora cluster"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.lab_name}-aurora-sg"
  }
}

# Aurora PostgreSQL Cluster
resource "aws_rds_cluster" "main" {
  cluster_identifier = "${var.lab_name}-aurora"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  engine_version     = "15.4"
  database_name      = "postgres"

  master_username = "labadmin"
  master_password = random_password.master.result

  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.aurora.id]

  # Serverless v2 configuration
  serverlessv2_scaling_configuration {
    min_capacity = var.min_capacity
    max_capacity = var.max_capacity
  }

  # Enable IAM authentication
  iam_database_authentication_enabled = true

  # Backup configuration
  backup_retention_period = 7
  preferred_backup_window = "03:00-04:00"

  # Maintenance window
  preferred_maintenance_window = "sun:04:00-sun:05:00"

  # Skip final snapshot for dev
  skip_final_snapshot = true

  # Enable deletion protection in production
  deletion_protection = var.environment == "prod"

  tags = {
    Name = "${var.lab_name}-aurora"
  }
}

# Aurora Serverless v2 Instance
resource "aws_rds_cluster_instance" "main" {
  identifier         = "${var.lab_name}-aurora-1"
  cluster_identifier = aws_rds_cluster.main.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.main.engine
  engine_version     = aws_rds_cluster.main.engine_version

  tags = {
    Name = "${var.lab_name}-aurora-instance"
  }
}
