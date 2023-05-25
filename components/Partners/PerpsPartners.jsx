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
  L2_SAFE_ADDRESS,
  L2_SNX_TOKEN_ADDRESS,
  PARTNER_ADDRESSES_L2,
  SNX_TOTAL_PARTNERS_DISTRIBUTION,
} from "../../config.js";

const snxClient = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/synthetixio-team/synthetix-rates",
  cache: new InMemoryCache(),
});

const perpsV2Query = (blockNumber) => `
{
  frontends (block: {number: ${blockNumber}}) {
    id
    fees
  }
}
`;

const perpsV2Client = new ApolloClient({
  uri: "https://api.thegraph.com/subgraphs/name/synthetix-perps/perps",
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
  console.log(network);
  const safeBatchSubmitter = new SafeBatchSubmitter({
    network: "optimism",
    signer,
    safeAddress: L2_SAFE_ADDRESS,
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

      const perpsV2StartPartnersResult = await perpsV2Client.query({
        query: gql(perpsV2Query(l2StartBlock)),
      });
      const perpsV2EndPartnersResult = await perpsV2Client.query({
        query: gql(perpsV2Query(l2EndBlock)),
      });

      const snxPriceResult = await snxClient.query({
        query: gql(`{
        fifteenMinuteSNXPrices(orderBy: id, orderDirection: desc, first: 1) {
          id
          averagePrice
        }
      }`),
      });

      const snxPrice =
        snxPriceResult.data.fifteenMinuteSNXPrices[0].averagePrice / 10 ** 18;

      processData(
        perpsV2StartPartnersResult,
        perpsV2EndPartnersResult,
        snxPrice
      );

      setLoadedGraph(true);
    })();
  }, []);

  const processData = (
    perpsV2StartPartnersResult,
    perpsV2EndPartnersResult,
    snxPrice
  ) => {
    // Calculate fees for the period by taking the difference between the totals at start and end
    let result = Object.keys(PARTNER_ADDRESSES_L2).map((id) => {
      const perpsV2PeriodStartData =
        perpsV2StartPartnersResult.data.frontends.filter(
          (p) => p.id.toUpperCase() == id.toUpperCase()
        )[0];
      const perpsV2PeriodEndData =
        perpsV2EndPartnersResult.data.frontends.filter(
          (p) => p.id.toUpperCase() == id.toUpperCase()
        )[0];
      let perpsV2Fees =
        (perpsV2PeriodEndData ? perpsV2PeriodEndData.fees : 0) -
        (perpsV2PeriodStartData ? perpsV2PeriodStartData.fees : 0);
      perpsV2Fees = perpsV2Fees / 10 ** 18;

      return {
        id: id,
        fees: perpsV2Fees,
      };
    });

    // Calculate payout based on proportion of fees generated in the period
    const totalFees = result.reduce((acc, p) => {
      return acc + p.fees;
    }, 0);
    result = result.map((r) => {
      if (r.fees < 1000000) {
        r.payout = r.fees * 0.1;
      } else if (r.fees <= 5000000) {
        r.payout = r.fees * 0.075;
      } else {
        r.payout = r.fees * 0.5;
      }
      r.payout = r.payout / snxPrice;
      return r;
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
      L2_SNX_TOKEN_ADDRESS,
      erc20Interface,
      provider
    );
    const currentBalance = await snxContract.balanceOf(L2_SAFE_ADDRESS);
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
          PARTNER_ADDRESSES_L2[partner.id],
          ethers.utils.parseEther(partner.payout.toString()),
        ]);
        await safeBatchSubmitter.appendTransaction({
          to: L2_SNX_TOKEN_ADDRESS,
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
      <PartnersTable layer={2} partnersData={partnersData} />
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
