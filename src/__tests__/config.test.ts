describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load config with required environment variables', () => {
    process.env.ETH_RPC_URL = 'https://eth-mainnet.example.com';
    process.env.TARGET_ADDRESS = '0xef4fb24ad0916217251f553c0596f8edc630eb66';
    process.env.USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    const { config } = require('../config');

    expect(config.rpc.url).toBe('https://eth-mainnet.example.com');
    expect(config.target.address.toLowerCase()).toBe('0xef4fb24ad0916217251f553c0596f8edc630eb66');
    expect(config.target.usdcContract.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  it('should use default values for optional settings', () => {
    process.env.ETH_RPC_URL = 'https://eth-mainnet.example.com';
    process.env.TARGET_ADDRESS = '0xef4fb24ad0916217251f553c0596f8edc630eb66';
    process.env.USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    const { config } = require('../config');

    expect(config.target.minEvents).toBe(5000);
    expect(config.collection.blockBatchSize).toBe(2000);
    expect(config.collection.maxRetries).toBe(5);
    expect(config.clickhouse.host).toBe('localhost');
    expect(config.clickhouse.port).toBe(8123);
  });

  it('should throw error for missing required variables', () => {
    delete process.env.ETH_RPC_URL;
    delete process.env.TARGET_ADDRESS;
    delete process.env.USDC_CONTRACT;

    expect(() => {
      jest.resetModules();
      require('../config');
    }).toThrow('Missing required environment variable');
  });

  it('should throw error for invalid Ethereum address', () => {
    process.env.ETH_RPC_URL = 'https://eth-mainnet.example.com';
    process.env.TARGET_ADDRESS = 'invalid-address';
    process.env.USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    expect(() => {
      jest.resetModules();
      require('../config');
    }).toThrow('Invalid Ethereum address');
  });
});
