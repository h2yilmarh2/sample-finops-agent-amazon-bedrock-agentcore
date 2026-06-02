# IAM Permissions Reference

This document details all IAM roles and permissions created by the FinOps Agent CDK deployment.

---

## 1. Main Agent Runtime Role

**Stack:** `FinOpsAgentRuntimeStack`
**Role Name:** `FinOpsAgentRuntimeStack-RuntimeRole`
**Assumed By:** `bedrock-agentcore.amazonaws.com`

| Action | Resource | Purpose |
|--------|----------|---------|
| `ecr:GetAuthorizationToken` | `*` | Pull container image from ECR |
| `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` | ECR repo ARN (`finops-agent-runtime`) | Pull agent container image |
| `logs:DescribeLogGroups` | `arn:aws:logs:{region}:{account}:log-group:*` | CloudWatch Logs discovery |
| `logs:DescribeLogStreams`, `logs:CreateLogGroup` | `arn:aws:logs:{region}:{account}:log-group:/aws/bedrock-agentcore/runtimes/*` | Create log groups |
| `logs:CreateLogStream`, `logs:PutLogEvents` | `arn:aws:logs:{region}:{account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*` | Write logs |
| `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `bedrock:ConverseStream`, `bedrock:Converse` | `arn:aws:bedrock:*::foundation-model/us.anthropic.claude-sonnet-4-5-*`, `arn:aws:bedrock:*:{account}:inference-profile/us.anthropic.claude-sonnet-4-5-*` | Invoke Claude Sonnet 4.5 |
| `bedrock-agentcore:CreateEvent`, `bedrock-agentcore:GetLastKTurns`, `bedrock-agentcore:GetMemory`, `bedrock-agentcore:ListEvents` | `arn:aws:bedrock-agentcore:{region}:{account}:memory/*` | AgentCore Memory (conversation history) |
| `bedrock-agentcore:InvokeGateway`, `bedrock-agentcore:GetGateway`, `bedrock-agentcore:ListGatewayTargets` | Gateway ARN + `/*` | Invoke MCP tools via Gateway |

---

## 2. Billing MCP Runtime Role

**Stack:** `FinOpsMCPRuntimeStack`
**Role Name:** `FinOpsMCPRuntimeStack-BillingMcpRuntimeRole`
**Assumed By:** `bedrock-agentcore.amazonaws.com`

### Common permissions (shared with Pricing and Data Processing roles)

| Action | Resource | Purpose |
|--------|----------|---------|
| `ecr:GetAuthorizationToken` | `*` | ECR auth token |
| `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability` | ECR repo ARN (`finops-billing-mcp-runtime`) | Pull container image |
| `logs:DescribeLogGroups` | `arn:aws:logs:{region}:{account}:log-group:*` | CloudWatch Logs discovery |
| `logs:DescribeLogStreams`, `logs:CreateLogGroup` | `arn:aws:logs:{region}:{account}:log-group:/aws/bedrock-agentcore/runtimes/*` | Create log groups |
| `logs:CreateLogStream`, `logs:PutLogEvents` | `arn:aws:logs:{region}:{account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*` | Write logs |
| `bedrock-agentcore:InvokeGateway` | `arn:aws:bedrock-agentcore:{region}:{account}:gateway/*` | Gateway invocation |

### Billing-specific permissions

| Action | Resource | Purpose |
|--------|----------|---------|
| `ce:*` | `*` | AWS Cost Explorer (all operations) |
| `budgets:*` | `*` | AWS Budgets (all operations) |
| `compute-optimizer:*` | `*` | AWS Compute Optimizer (all operations) |
| `freetier:*` | `*` | AWS Free Tier usage |
| `cost-optimization-hub:*` | `*` | Cost Optimization Hub |
| `pricing:GetProducts`, `pricing:GetAttributeValues`, `pricing:DescribeServices`, `pricing:ListPriceListFiles`, `pricing:GetPriceListFileUrl` | `*` | AWS Pricing API |
| `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeInstanceTypes`, `ec2:DescribeRegions` | `*` | EC2 metadata for optimization recommendations |
| `autoscaling:DescribeAutoScalingGroups` | `*` | ASG metadata for optimization |
| `lambda:ListFunctions`, `lambda:GetFunction` | `*` | Lambda metadata for optimization |
| `ecs:ListClusters`, `ecs:ListServices`, `ecs:DescribeServices` | `*` | ECS metadata for optimization |

> **Note:** The Billing role has broad permissions (`ce:*`, `budgets:*`, etc.) because Cost Explorer APIs are account-level services that don't support resource-level ARN scoping. For production, consider restricting to specific read-only actions.

---

## 3. Pricing MCP Runtime Role

**Stack:** `FinOpsMCPRuntimeStack`
**Role Name:** `FinOpsMCPRuntimeStack-PricingMcpRuntimeRole`
**Assumed By:** `bedrock-agentcore.amazonaws.com`

### Common permissions
Same as Billing role (ECR, CloudWatch, Gateway) — see section 2.

### Pricing-specific permissions

| Action | Resource | Purpose |
|--------|----------|---------|
| `pricing:GetProducts` | `*` | Query product pricing |
| `pricing:GetAttributeValues` | `*` | Get filter values for pricing queries |
| `pricing:DescribeServices` | `*` | List available services |
| `pricing:ListPriceListFiles` | `*` | List price list files |
| `pricing:GetPriceListFileUrl` | `*` | Get price list download URLs |

> **Note:** AWS Pricing API is a global service — resource ARNs are not supported.

---

## 4. Data Processing MCP Runtime Role (conditional)

**Stack:** `FinOpsMCPRuntimeStack`
**Role Name:** `FinOpsMCPRuntimeStack-DataProcessingMcpRuntimeRole`
**Assumed By:** `bedrock-agentcore.amazonaws.com`
**Created only when:** `ATHENA_DATABASE`, `ATHENA_TABLE`, `ATHENA_OUTPUT_BUCKET`, and `CUR_S3_BUCKET` are provided.

### Common permissions
Same as Billing role (ECR, CloudWatch, Gateway) — see section 2.

### Athena permissions (scoped to workgroup)

| Action | Resource | Purpose |
|--------|----------|---------|
| `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`, `athena:StopQueryExecution`, `athena:ListQueryExecutions`, `athena:GetWorkGroup`, `athena:ListNamedQueries`, `athena:GetNamedQuery` | `arn:aws:athena:{region}:{account}:workgroup/{ATHENA_WORKGROUP}` | Execute and manage queries in specific workgroup |
| `athena:ListWorkGroups`, `athena:ListDatabases`, `athena:ListTableMetadata`, `athena:GetTableMetadata`, `athena:GetDatabase` | `arn:aws:athena:{region}:{account}:datacatalog/*` | Discover databases and tables (catalog-level) |

### Glue Catalog permissions (scoped to database)

| Action | Resource | Purpose |
|--------|----------|---------|
| `glue:GetDatabase`, `glue:GetDatabases`, `glue:GetTable`, `glue:GetTables`, `glue:GetPartition`, `glue:GetPartitions`, `glue:SearchTables` | `arn:aws:glue:{region}:{account}:catalog` | Access Glue catalog |
| Same as above | `arn:aws:glue:{region}:{account}:database/{ATHENA_DATABASE}` | Access specific CUR database |
| Same as above | `arn:aws:glue:{region}:{account}:table/{ATHENA_DATABASE}/{ATHENA_TABLE}` | Access specific CUR table |
| Same as above | `arn:aws:glue:{region}:{account}:table/{ATHENA_DATABASE}/*` | Access all tables in CUR database |

### S3 permissions (scoped to specific buckets)

| Action | Resource | Purpose |
|--------|----------|---------|
| `s3:GetObject`, `s3:ListBucket`, `s3:GetBucketLocation` | `arn:aws:s3:::{CUR_S3_BUCKET}`, `arn:aws:s3:::{CUR_S3_BUCKET}/*` | Read CUR data |
| `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:GetBucketLocation` | `arn:aws:s3:::{ATHENA_OUTPUT_BUCKET}`, `arn:aws:s3:::{ATHENA_OUTPUT_BUCKET}/*` | Read/write Athena query results |

---

## 5. Gateway Service Role

**Stack:** `FinOpsAgentCoreGatewayStack`
**Role Name:** Auto-generated
**Assumed By:** `bedrock-agentcore.amazonaws.com`

| Action | Resource | Purpose |
|--------|----------|---------|
| `bedrock-agentcore:GetWorkloadAccessToken`, `bedrock-agentcore:GetResourceOauth2Token` | `*` (managed policy) | Token exchange for Gateway auth |
| `bedrock-agentcore:GetResourceOauth2Token`, `bedrock-agentcore:GetWorkloadAccessToken` | OAuth Provider ARN | Scoped token exchange |
| `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret` | OAuth Secret ARN | Read M2M client secret |

---

## 6. OAuth Provider Lambda Role

**Stack:** `FinOpsAgentCoreGatewayStack`
**Role Name:** Auto-generated (Lambda execution role)
**Assumed By:** `lambda.amazonaws.com`

| Action | Resource | Purpose |
|--------|----------|---------|
| `bedrock-agentcore:CreateOauth2CredentialProvider`, `bedrock-agentcore:DeleteOauth2CredentialProvider`, `bedrock-agentcore:GetOauth2CredentialProvider`, `bedrock-agentcore:CreateTokenVault`, `bedrock-agentcore:GetTokenVault` | `*` | Manage OAuth credential provider lifecycle |
| `secretsmanager:CreateSecret`, `secretsmanager:DeleteSecret`, `secretsmanager:PutSecretValue`, `secretsmanager:TagResource` | `arn:aws:secretsmanager:{region}:{account}:secret:bedrock-agentcore-identity*` | Store OAuth client credentials |

---

## 7. Cognito Authenticated Role (Frontend Users)

**Stack:** `FinOpsAuthStack`
**Role Name:** `FinOpsAuthStack-authenticated-role`
**Assumed By:** `cognito-identity.amazonaws.com` (federated, authenticated users only)

| Action | Resource | Purpose |
|--------|----------|---------|
| `bedrock-agentcore:InvokeAgentRuntime`, `bedrock-agentcore:GetRuntime`, `bedrock-agentcore:ListRuntimes` | `arn:aws:bedrock-agentcore:{region}:{account}:runtime/finops_billing_mcp*`, `arn:aws:bedrock-agentcore:{region}:{account}:runtime/finops_pricing_mcp*`, `arn:aws:bedrock-agentcore:{region}:{account}:runtime/finops_runtime*` | Frontend users invoke the agent |

---

## 8. Cognito Unauthenticated Role

**Stack:** `FinOpsAuthStack`
**Role Name:** `FinOpsAuthStack-unauthenticated-role`
**Assumed By:** `cognito-identity.amazonaws.com` (federated, unauthenticated)

| Action | Resource | Purpose |
|--------|----------|---------|
| `*` (DENY) | `*` | Block all access for unauthenticated users |

---

## 9. CodeBuild Roles (Image Build)

**Stack:** `FinOpsImageStack`
**Role Names:** Auto-generated per build project
**Assumed By:** `codebuild.amazonaws.com`

| Action | Resource | Purpose |
|--------|----------|---------|
| `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` | `arn:aws:logs:{region}:{account}:log-group:/aws/codebuild/*` | Build logs |
| `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` | Specific ECR repo ARN | Push built images |
| `ecr:GetAuthorizationToken` | `*` | ECR login |
| `s3:GetObject`, `s3:GetObjectVersion` | Source bucket `/*` | Read build scripts |

---

## Summary: Wildcard (`*`) Resources

| Role | Actions with `*` resource | Justification |
|------|--------------------------|---------------|
| All roles | `ecr:GetAuthorizationToken` | ECR auth token is account-level, no ARN scoping |
| Billing MCP | `ce:*`, `budgets:*`, `compute-optimizer:*`, `freetier:*`, `cost-optimization-hub:*` | Account-level services, no resource ARNs |
| Billing MCP | `pricing:*`, `ec2:Describe*`, `autoscaling:Describe*`, `lambda:List/Get*`, `ecs:List/Describe*` | Read-only, global/account-level |
| Pricing MCP | `pricing:*` | Global service, no resource ARNs |
| Data Processing MCP | `athena:List*/Get*` on `datacatalog/*` | Catalog discovery requires datacatalog wildcard |
| Gateway | Token exchange (managed policy) | Required by AgentCore Gateway service |
| OAuth Lambda | `bedrock-agentcore:Create/Delete/Get*` | Provider lifecycle management |
