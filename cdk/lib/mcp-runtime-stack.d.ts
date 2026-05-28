import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
export interface MCPRuntimeStackProps extends cdk.StackProps {
    billingMcpRepository: ecr.IRepository;
    pricingMcpRepository: ecr.IRepository;
    dataProcessingMcpRepository: ecr.IRepository;
    userPoolId: string;
    m2mClientId: string;
    athenaDatabase: string;
    athenaTable: string;
    athenaOutputBucket: string;
    curS3Bucket: string;
    curS3Prefix: string;
}
export declare class MCPRuntimeStack extends cdk.Stack {
    readonly billingMcpRuntimeArn: string;
    readonly pricingMcpRuntimeArn: string;
    readonly billingMcpRuntimeEndpoint: string;
    readonly pricingMcpRuntimeEndpoint: string;
    readonly dataProcessingMcpRuntimeArn: string;
    readonly dataProcessingMcpRuntimeEndpoint: string;
    constructor(scope: Construct, id: string, props: MCPRuntimeStackProps);
}
