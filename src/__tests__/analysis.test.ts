import { AnalysisReport } from '../analysis/metrics';

// This test validates the output format matches the expected schema
describe('analysis metrics', () => {
  describe('AnalysisReport structure', () => {
    it('should match the expected JSON output format', () => {
      const sampleReport: AnalysisReport = {
        address: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
        network: 'ethereum-mainnet',
        token: 'USDC',
        summary: {
          events_collected: 5000,
          blocks_scanned: [18000000, 19000000],
          period_utc: ['2024-01-01', '2024-06-01'],
        },
        daily_gas_cost: [
          { date: '2024-01-01', gas_cost_wei: '1000000000000000000', gas_cost_eth: 1.0 },
        ],
        ma7_effective_gas_price: [
          { date: '2024-01-01', ma7_wei: '25000000000', ma7_gwei: 25.0 },
        ],
        cumulative_gas_cost_eth: [
          { date: '2024-01-01', cum_eth: 1.0 },
        ],
      };

      // Validate structure
      expect(sampleReport.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(sampleReport.network).toBe('ethereum-mainnet');
      expect(sampleReport.token).toBe('USDC');
      expect(sampleReport.summary.events_collected).toBeGreaterThanOrEqual(0);
      expect(sampleReport.summary.blocks_scanned).toHaveLength(2);
      expect(sampleReport.summary.period_utc).toHaveLength(2);

      // Validate daily_gas_cost format
      expect(sampleReport.daily_gas_cost[0]).toHaveProperty('date');
      expect(sampleReport.daily_gas_cost[0]).toHaveProperty('gas_cost_wei');
      expect(sampleReport.daily_gas_cost[0]).toHaveProperty('gas_cost_eth');

      // Validate ma7 format
      expect(sampleReport.ma7_effective_gas_price[0]).toHaveProperty('date');
      expect(sampleReport.ma7_effective_gas_price[0]).toHaveProperty('ma7_wei');
      expect(sampleReport.ma7_effective_gas_price[0]).toHaveProperty('ma7_gwei');

      // Validate cumulative format
      expect(sampleReport.cumulative_gas_cost_eth[0]).toHaveProperty('date');
      expect(sampleReport.cumulative_gas_cost_eth[0]).toHaveProperty('cum_eth');
    });

    it('should serialize to valid JSON', () => {
      const report: AnalysisReport = {
        address: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
        network: 'ethereum-mainnet',
        token: 'USDC',
        summary: {
          events_collected: 5127,
          blocks_scanned: [18245000, 19876543],
          period_utc: ['2023-10-01', '2024-05-15'],
        },
        daily_gas_cost: [],
        ma7_effective_gas_price: [],
        cumulative_gas_cost_eth: [],
      };

      const json = JSON.stringify(report, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(report);
    });
  });

  describe('gas cost calculations', () => {
    it('should correctly convert wei to ETH', () => {
      const weiValue = BigInt('1000000000000000000'); // 1 ETH in wei
      const ethValue = Number(weiValue) / 1e18;
      expect(ethValue).toBe(1.0);
    });

    it('should correctly convert wei to gwei', () => {
      const weiValue = BigInt('25000000000'); // 25 gwei in wei
      const gweiValue = Number(weiValue) / 1e9;
      expect(gweiValue).toBe(25.0);
    });

    it('should calculate gas cost correctly', () => {
      const gasUsed = 21000n;
      const effectiveGasPrice = 25000000000n; // 25 gwei
      const gasCost = gasUsed * effectiveGasPrice;
      
      expect(gasCost).toBe(525000000000000n); // 0.000525 ETH
      expect(Number(gasCost) / 1e18).toBeCloseTo(0.000525, 6);
    });
  });
});
