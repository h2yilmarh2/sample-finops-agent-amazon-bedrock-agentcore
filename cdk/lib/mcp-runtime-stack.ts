import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface MCPRuntimeStackProps extends cdk.StackProps {
  billingMcpRepository: ecr.IRepository;
  pricingMcpRepository: ecr.IRepository;
  dataProcessingMcpRepository: ecr.IRepository;
  // From AuthStack - for JWT authorization on runtimes
  userPoolId: string;
  m2mClientId: string;
  // Data Processing MCP configuration
  athenaDatabase: string;
  athenaTable: string;
  athenaOutputBucket: string;
  curS3Bucket: string;
  curS3Prefix: string;
}

export class MCPRuntimeStack extends cdk.Stack {
  public readonly billingMcpRuntimeArn: string;
  public readonly pricingMcpRuntimeArn: string;
  public readonly billingMcpRuntimeEndpoint: string;
  public readonly pricingMcpRuntimeEndpoint: string;
  public readonly dataProcessingMcpRuntimeArn: string;
  public readonly dataProcessingMcpRuntimeEndpoint: string;

  constructor(scope: Construct, id: string, props: MCPRuntimeStackProps) {
    super(scope, id, props);

    // ========================================
    // IAM Roles for MCP Runtimes
    // ========================================

    // Billing MCP Server Runtime Role
    const billingMcpRuntimeRole = new iam.Role(this, 'BillingMcpRuntimeRole', {
      roleName: `${this.stackName}-BillingMcpRuntimeRole`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Pricing MCP Server Runtime Role
    const pricingMcpRuntimeRole = new iam.Role(this, 'PricingMcpRuntimeRole', {
      roleName: `${this.stackName}-PricingMcpRuntimeRole`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Common AgentCore Runtime permissions (ECR, CloudWatch, X-Ray, Bedrock, Gateway)
    const commonRuntimePermissions: iam.PolicyStatement[] = [
      // ECR token access
      new iam.PolicyStatement({
        sid: 'ECRTokenAccess',
        effect: iam.Effect.ALLOW,
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
      // CloudWatch Logs
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
      }),
      // Gateway invocation
      new iam.PolicyStatement({
        sid: 'AllowGatewayInvocation',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeGateway'],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:${this.account}:gateway/*`],
      }),
    ];

    // Add common permissions to both roles
    for (const stmt of commonRuntimePermissions) {
      billingMcpRuntimeRole.addToPolicy(stmt);
      pricingMcpRuntimeRole.addToPolicy(stmt);
    }

    // ECR image pull for each role's specific repository
    props.billingMcpRepository.grantPull(billingMcpRuntimeRole);
    props.pricingMcpRepository.grantPull(pricingMcpRuntimeRole);

    // Add Cost Explorer and billing permissions to Billing MCP Runtime
    billingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:*',
        'budgets:*',
        'compute-optimizer:*',
        'freetier:*',
        'cost-optimization-hub:*',
        'pricing:GetProducts',
        'pricing:GetAttributeValues',
        'pricing:DescribeServices',
        'pricing:ListPriceListFiles',
        'pricing:GetPriceListFileUrl',
        'ec2:DescribeInstances',
        'ec2:DescribeVolumes',
        'ec2:DescribeInstanceTypes',
        'ec2:DescribeRegions',
        'autoscaling:DescribeAutoScalingGroups',
        'lambda:ListFunctions',
        'lambda:GetFunction',
        'ecs:ListClusters',
        'ecs:ListServices',
        'ecs:DescribeServices',
      ],
      resources: ['*'],
    }));

    // Add Pricing API permissions to Pricing MCP Runtime
    pricingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'pricing:GetProducts',
        'pricing:GetAttributeValues',
        'pricing:DescribeServices',
        'pricing:ListPriceListFiles',
        'pricing:GetPriceListFileUrl',
      ],
      resources: ['*'],
    }));

    // ========================================
    // MCP Runtimes with JWT Authorization
    // Gateway sends OAuth Bearer tokens, Runtimes validate JWT
    // ========================================

    // Billing MCP Server Runtime
    const cfnBillingMcpRuntime = new cdk.CfnResource(this, 'BillingMcpRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'finops_billing_mcp_jwt_v1',
        Description: 'AWS Labs Billing MCP Server Runtime with JWT authorization',
        RoleArn: billingMcpRuntimeRole.roleArn,
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [props.m2mClientId],
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
          }
        },
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${props.billingMcpRepository.repositoryUri}:latest`
          }
        },
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC'
        },
        EnvironmentVariables: {
          AWS_REGION: this.region,
          DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
        },
        ProtocolConfiguration: 'MCP',
        LifecycleConfiguration: {},
      }
    });
    
    cfnBillingMcpRuntime.node.addDependency(billingMcpRuntimeRole);

    this.billingMcpRuntimeArn = cfnBillingMcpRuntime.getAtt('AgentRuntimeArn').toString();
    // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
    // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
    // The ARN must be URL-encoded (: → %3A, / → %2F)
    // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
    const encodedBillingArn = cdk.Fn.join('', [
      cdk.Fn.select(0, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(1, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(2, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(3, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(4, cdk.Fn.split(':', this.billingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.billingMcpRuntimeArn)))),
    ]);
    this.billingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedBillingArn}/invocations?qualifier=DEFAULT`;

    // Pricing MCP Server Runtime
    const cfnPricingMcpRuntime = new cdk.CfnResource(this, 'PricingMcpRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'finops_pricing_mcp_jwt_v1',
        Description: 'AWS Labs Pricing MCP Server Runtime with JWT authorization',
        RoleArn: pricingMcpRuntimeRole.roleArn,
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [props.m2mClientId],
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
          }
        },
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${props.pricingMcpRepository.repositoryUri}:latest`
          }
        },
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC'
        },
        EnvironmentVariables: {
          AWS_REGION: this.region,
          DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
        },
        ProtocolConfiguration: 'MCP',
        LifecycleConfiguration: {},
      }
    });
    
    cfnPricingMcpRuntime.node.addDependency(pricingMcpRuntimeRole);

    this.pricingMcpRuntimeArn = cfnPricingMcpRuntime.getAtt('AgentRuntimeArn').toString();
    // MCP Runtime endpoint format for AgentCore Gateway targets (from AWS documentation)
    // Format: https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{ENCODED_ARN}/invocations?qualifier=DEFAULT
    // The ARN must be URL-encoded (: → %3A, / → %2F)
    // Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
    const encodedPricingArn = cdk.Fn.join('', [
      cdk.Fn.select(0, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(1, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(2, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(3, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(4, cdk.Fn.split(':', this.pricingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.pricingMcpRuntimeArn)))),
    ]);
    this.pricingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedPricingArn}/invocations?qualifier=DEFAULT`;

    // ========================================
    // Data Processing MCP Server Runtime
    // ========================================

    const dataProcessingMcpRuntimeRole = new iam.Role(this, 'DataProcessingMcpRuntimeRole', {
      roleName: `${this.stackName}-DataProcessingMcpRuntimeRole`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });

    // Add common permissions
    for (const stmt of commonRuntimePermissions) {
      dataProcessingMcpRuntimeRole.addToPolicy(stmt);
    }
    props.dataProcessingMcpRepository.grantPull(dataProcessingMcpRuntimeRole);

    // Athena permissions
    dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution',
        'athena:ListQueryExecutions',
        'athena:GetWorkGroup',
        'athena:ListWorkGroups',
        'athena:ListNamedQueries',
        'athena:GetNamedQuery',
        'athena:ListDatabases',
        'athena:ListTableMetadata',
        'athena:GetTableMetadata',
        'athena:GetDatabase',
      ],
      resources: ['*'],
    }));

    // Glue Catalog permissions
    dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:GetDatabase',
        'glue:GetDatabases',
        'glue:GetTable',
        'glue:GetTables',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:SearchTables',
      ],
      resources: ['*'],
    }));

    // S3 permissions for CUR bucket and Athena results
    const s3Resources = ['arn:aws:s3:::*'];
    const s3ObjectResources = ['arn:aws:s3:::*/*'];

    dataProcessingMcpRuntimeRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:PutObject',
      ],
      resources: [...s3Resources, ...s3ObjectResources],
    }));

    // Environment variables for the runtime
    const dataProcessingEnvVars: { [key: string]: string } = {
      AWS_REGION: this.region,
      DEPLOYMENT_TIMESTAMP: new Date().toISOString(),
      ATHENA_DATABASE: props.athenaDatabase,
      ATHENA_TABLE: props.athenaTable,
      ATHENA_OUTPUT_BUCKET: props.athenaOutputBucket,
      CUR_S3_BUCKET: props.curS3Bucket,
      CUR_S3_PREFIX: props.curS3Prefix,
    };

    const cfnDataProcessingMcpRuntime = new cdk.CfnResource(this, 'DataProcessingMcpRuntime', {
      type: 'AWS::BedrockAgentCore::Runtime',
      properties: {
        AgentRuntimeName: 'finops_dataprocessing_mcp_jwt_v1',
        Description: 'AWS Labs Data Processing MCP Server Runtime (Athena/Glue) with JWT authorization',
        RoleArn: dataProcessingMcpRuntimeRole.roleArn,
        AuthorizerConfiguration: {
          CustomJWTAuthorizer: {
            AllowedClients: [props.m2mClientId],
            DiscoveryUrl: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
          }
        },
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: `${props.dataProcessingMcpRepository.repositoryUri}:latest`
          }
        },
        NetworkConfiguration: {
          NetworkMode: 'PUBLIC'
        },
        EnvironmentVariables: dataProcessingEnvVars,
        ProtocolConfiguration: 'MCP',
        LifecycleConfiguration: {},
      }
    });

    cfnDataProcessingMcpRuntime.node.addDependency(dataProcessingMcpRuntimeRole);

    this.dataProcessingMcpRuntimeArn = cfnDataProcessingMcpRuntime.getAtt('AgentRuntimeArn').toString();
    const encodedDataProcessingArn = cdk.Fn.join('', [
      cdk.Fn.select(0, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(1, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(2, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(3, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.select(4, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)),
      '%3A',
      cdk.Fn.join('%2F', cdk.Fn.split('/', cdk.Fn.select(5, cdk.Fn.split(':', this.dataProcessingMcpRuntimeArn)))),
    ]);
    this.dataProcessingMcpRuntimeEndpoint = `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/${encodedDataProcessingArn}/invocations?qualifier=DEFAULT`;

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'BillingMcpRuntimeArn', {
      value: this.billingMcpRuntimeArn,
      description: 'Billing MCP Server Runtime ARN',
      exportName: `${this.stackName}-BillingMcpRuntimeArn`,
    });

    new cdk.CfnOutput(this, 'BillingMcpRuntimeEndpoint', {
      value: this.billingMcpRuntimeEndpoint,
      description: 'Billing MCP Server Runtime Endpoint',
      exportName: `${this.stackName}-BillingMcpRuntimeEndpoint`,
    });

    new cdk.CfnOutput(this, 'PricingMcpRuntimeArn', {
      value: this.pricingMcpRuntimeArn,
      description: 'Pricing MCP Server Runtime ARN',
      exportName: `${this.stackName}-PricingMcpRuntimeArn`,
    });

    new cdk.CfnOutput(this, 'PricingMcpRuntimeEndpoint', {
      value: this.pricingMcpRuntimeEndpoint,
      description: 'Pricing MCP Server Runtime Endpoint',
      exportName: `${this.stackName}-PricingMcpRuntimeEndpoint`,
    });

    new cdk.CfnOutput(this, 'DataProcessingMcpRuntimeArn', {
      value: this.dataProcessingMcpRuntimeArn,
      description: 'Data Processing MCP Server Runtime ARN',
      exportName: `${this.stackName}-DataProcessingMcpRuntimeArn`,
    });

    new cdk.CfnOutput(this, 'DataProcessingMcpRuntimeEndpoint', {
      value: this.dataProcessingMcpRuntimeEndpoint,
      description: 'Data Processing MCP Server Runtime Endpoint',
      exportName: `${this.stackName}-DataProcessingMcpRuntimeEndpoint`,
    });

    // ========================================
    // CDK-Nag Suppressions
    // ========================================

    NagSuppressions.addResourceSuppressions(billingMcpRuntimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for Cost Explorer APIs (account-level services), ECR auth token, CloudWatch, X-Ray',
      },
    ], true);

    NagSuppressions.addResourceSuppressions(pricingMcpRuntimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for AWS Pricing API (global service), ECR auth token, CloudWatch, X-Ray',
      },
    ], true);

    NagSuppressions.addResourceSuppressions(dataProcessingMcpRuntimeRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for Athena, Glue Catalog, S3 (CUR data + query results), ECR auth token, CloudWatch',
      },
    ], true);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Python 3.14 is the latest Lambda runtime version available',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWSLambdaBasicExecutionRole managed policy is AWS best practice for Lambda functions',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions required for custom resource Lambda functions',
      },
    ]);
  }
}
