import { useEffect, useState } from "react";

import { Button, useToast, Grid } from "@chakra-ui/react";

import PartnersTable from "./PartnersTable";
import Period from "./Period";

import { loadedGraph } from "../../store";
import { useRecoilState } from "recoil";

import { ApolloClient, InMemoryCache, gql } from "@apollo/client";
import { format, startOfMonth, subMonths } from "date-fns";
import { ethers } from "ethers";
import SafeBatchSubmitter from "../../lib/SafeBatchSubmitter.js";

import {
  L1_SAFE_ADDRESS,
  L1_SNX_TOKEN_ADDRESS,
  PARTNER_ADDRESSES_L1,
  SNX_TOTAL_PARTNERS_DISTRIBUTION,
} from "../../config.js";

const snxQuery = (blockNumber) => `
{
  exchangePartners (block: {number: ${blockNumber}}) {
    id
    usdVolume
    usdFees
    trades
  }
}
`;

const l1SnxClient = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/synthetixio-team/mainnet-main",
  cache: new InMemoryCache(),
});

const l2SnxClient = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/synthetixio-team/optimism-main",
  cache: new InMemoryCache(),
});

const blocksQuery = (timestamp) => `
{
  blocks(first: 1, orderBy: timestamp, orderDirection: asc, where: {timestamp_gte: "${timestamp}"}) {
    id
    number
    timestamp
  }
}
`;

const l1BlocksClient = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/blocklytics/ethereum-blocks",
  cache: new InMemoryCache(),
});

const l2BlocksClient = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/noahlitvin/optimism-blocks",
  cache: new InMemoryCache(),
});

async function generateSafeBatchSubmitter() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  let signer = provider.getSigner();
  signer.address = await signer.getAddress();
  let network = await provider.getNetwork();
  const safeBatchSubmitter = new SafeBatchSubmitter({
    network: network.name,
    signer,
    safeAddress: L1_SAFE_ADDRESS,
  });
  await safeBatchSubmitter.init();
  return safeBatchSubmitter;
}

const Partners = () => {
  const [partnersData, setPartnersData] = useState([]);
  const [l1StartBlockNumber, setL1StartBlockNumber] = useState(0);
  const [l1EndBlockNumber, setL1EndBlockNumber] = useState(0);
  const [l2StartBlockNumber, setL2StartBlockNumber] = useState(0);
  const [l2EndBlockNumber, setL2EndBlockNumber] = useState(0);
  const [periodName, setPeriodName] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const [, setLoadedGraph] = useRecoilState(loadedGraph);

  useEffect(() => {
    (async () => {
      // Get block numbers corresponding to the start of this month and last month
      const periodEnd = startOfMonth(new Date());
      const periodStart = subMonths(periodEnd, 1);
      setPeriodName(format(periodStart, "MMMM y"));

      const startTimeOffsetMs = periodStart.getTimezoneOffset() * 60 * 1000;
      const endTimeOffsetMs = periodEnd.getTimezoneOffset() * 60 * 1000;

      const l1StartBlock = (
        await l1BlocksClient.query({
          query: gql(
            blocksQuery((periodStart.getTime() - startTimeOffsetMs) / 1000)
          ),
        })
      ).data.blocks[0].number;
      const l1EndBlock = (
        await l1BlocksClient.query({
          query: gql(
            blocksQuery((periodEnd.getTime() - endTimeOffsetMs) / 1000)
          ),
        })
      ).data.blocks[0].number;
      const l2StartBlock = (
        await l2BlocksClient.query({
          query: gql(
            blocksQuery((periodStart.getTime() - startTimeOffsetMs) / 1000)
          ),
        })
      ).data.blocks[0].number;
      const l2EndBlock = (
        await l2BlocksClient.query({
          query: gql(
            blocksQuery((periodEnd.getTime() - endTimeOffsetMs) / 1000)
          ),
        })
      ).data.blocks[0].number;
      setL1StartBlockNumber(l1StartBlock);
      setL1EndBlockNumber(l1EndBlock);
      setL2StartBlockNumber(l2StartBlock);
      setL2EndBlockNumber(l2EndBlock);

      const l1StartPartnersResult = await l1SnxClient.query({
        query: gql(snxQuery(l1StartBlock)),
      });
      const l1EndPartnersResult = await l1SnxClient.query({
        query: gql(snxQuery(l1EndBlock)),
      });
      const l2StartPartnersResult = await l2SnxClient.query({
        query: gql(snxQuery(l2StartBlock)),
      });
      const l2EndPartnersResult = await l2SnxClient.query({
        query: gql(snxQuery(l2EndBlock)),
      });

      processData(
        l1StartPartnersResult,
        l1EndPartnersResult,
        l2StartPartnersResult,
        l2EndPartnersResult
      );

      setLoadedGraph(true);
    })();
  }, []);

  const processData = (
    l1StartPartnersResult,
    l1EndPartnersResult,
    l2StartPartnersResult,
    l2EndPartnersResult
  ) => {
    // Calculate fees for the period by taking the difference between the totals at start and end
    let result = Object.keys(PARTNER_ADDRESSES_L1).map((id) => {
      const l1PeriodStartData =
        l1StartPartnersResult.data.exchangePartners.filter(
          (p) => p.id.toUpperCase() == id.toUpperCase()
        )[0];
      const l1PeriodEndData = l1EndPartnersResult.data.exchangePartners.filter(
        (p) => p.id.toUpperCase() == id.toUpperCase()
      )[0];
      const l1Fees =
        (l1PeriodEndData ? l1PeriodEndData.usdFees : 0) -
        (l1PeriodStartData ? l1PeriodStartData.usdFees : 0);

      const l2PeriodStartData =
        l2StartPartnersResult.data.exchangePartners.filter(
          (p) => p.id.toUpperCase() == id.toUpperCase()
        )[0];
      const l2PeriodEndData = l2EndPartnersResult.data.exchangePartners.filter(
        (p) => p.id.toUpperCase() == id.toUpperCase()
      )[0];
      const l2Fees =
        (l2PeriodEndData ? l2PeriodEndData.usdFees : 0) -
        (l2PeriodStartData ? l2PeriodStartData.usdFees : 0);

      return {
        id: id,
        fees: l1Fees + l2Fees,
      };
    });

    // Calculate payout based on proportion of fees generated in the period
    const totalFees = result.reduce((acc, p) => {
      return acc + p.fees;
    }, 0);
    result = result
      .map((r) => {
        r.percentage = r.fees / totalFees;
        r.payout = SNX_TOTAL_PARTNERS_DISTRIBUTION * r.percentage;
        return r;
      })
      .sort((a, b) => {
        return b.percentage > a.percentage ? 1 : -1;
      });

    setPartnersData(result);
  };

  const queueActions = async () => {
    setLoading(true);

    const erc20Interface = new ethers.utils.Interface([
      "function transfer(address recipient, uint256 amount)",
      "function balanceOf(address account) view returns (uint256)",
    ]);

    // Confirm the Gnosis Safe has a sufficient balance
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    const snxContract = new ethers.Contract(
      L1_SNX_TOKEN_ADDRESS,
      erc20Interface,
      provider
    );
    const currentBalance = await snxContract.balanceOf(L1_SAFE_ADDRESS);
    const parsedBalance = parseInt(ethers.utils.formatEther(currentBalance));
    if (SNX_TOTAL_PARTNERS_DISTRIBUTION > parsedBalance) {
      toast({
        title: "Insufficient Funds",
        description: `The safe doesn't have enough SNX tokens to complete this payout.`,
        status: "error",
        isClosable: true,
      });
      setLoading(false);
      return;
    }

    // Queue transactions
    const safeBatchSubmitter = await generateSafeBatchSubmitter();

    for (let index = 0; index < partnersData.length; index++) {
      const partner = partnersData[index];
      if (partner.payout > 0) {
        const data = erc20Interface.encodeFunctionData("transfer", [
          PARTNER_ADDRESSES_L1[partner.id],
          ethers.utils.parseEther(partner.payout.toString()),
        ]);
        await safeBatchSubmitter.appendTransaction({
          to: L1_SNX_TOKEN_ADDRESS,
          data,
          force: false,
        });
      }
    }

    // Submit transactions
    try {
      const submitResult = await safeBatchSubmitter.submit();
      toast({
        title: "Transactions Queued",
        description: submitResult.transactions.length
          ? `You’ve successfully queued ${submitResult.transactions.length} transactions in the Gnosis Safe.`
          : "New transactions weren’t added. They are likely already awaiting execution in the Gnosis Safe.",
        status: "success",
        isClosable: true,
      });
    } catch {
      toast({
        title: "Error",
        description: `Something went wrong when attempting to queue these transactions.`,
        status: "error",
        isClosable: true,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Period
        periodName={periodName}
        l1StartBlockNumber={l1StartBlockNumber}
        l1EndBlockNumber={l1EndBlockNumber}
        l2StartBlockNumber={l2StartBlockNumber}
        l2EndBlockNumber={l2EndBlockNumber}
      />
      <PartnersTable layer={1} partnersData={partnersData} />
      <Button
        background="#00d1ff"
        width="100%"
        _hover={{ background: "#58e1ff" }}
        color="white"
        onClick={queueActions}
        mb={8}
        size="lg"
        isLoading={loading}
        textTransform="uppercase"
        fontFamily="GT America"
        letterSpacing={1}
        fontWeight={400}
      >
        Queue Payouts
      </Button>
    </div>
  );
};

export default Partners;
