import { useState, useEffect } from "react";
import {
  Button,
  Spinner,
  Box,
  Input,
  FormControl,
  FormLabel,
  FormHelperText,
  useToast,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import Council from "./Council";
import { ApolloClient, InMemoryCache, gql } from "@apollo/client";
import { ethers } from "ethers";
import SafeBatchSubmitter from "../../lib/SafeBatchSubmitter.js";
import {
  COUNCIL_SAFE_ADDRESS,
  L1_SNX_TOKEN_ADDRESS,
  SPARTAN_COUNCIL_NFT_ADDRESS,
  AMBASSADORS_COUNCIL_NFT_ADDRESS,
  GRANTS_COUNCIL_NFT_ADDRESS,
  TREASURY_COUNCIL_NFT_ADDRESS,
} from "../../config.js";

async function generateSafeBatchSubmitter() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  let signer = provider.getSigner();
  signer.address = await signer.getAddress();
  let network = await provider.getNetwork();
  const safeBatchSubmitter = new SafeBatchSubmitter({
    network: network.name,
    signer,
    safeAddress: COUNCIL_SAFE_ADDRESS,
  });
  await safeBatchSubmitter.init();
  return safeBatchSubmitter;
}

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

const CouncilMembers = () => {
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [payouts, setPayouts] = useState({});
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [l1blockNumber, setL1BlockNumber] = useState(0);
  const [l2blockNumber, setL2BlockNumber] = useState(0);
  const [infuraKey, setInfuraKey] = useState("");
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setLoadingMembers(true);
      const l1result = await l1BlocksClient.query({
        query: gql(blocksQuery(new Date(date).getTime() / 1000)),
      });
      const l2result = await l2BlocksClient.query({
        query: gql(blocksQuery(new Date(date).getTime() / 1000)),
      });
      if (l1result.data.blocks[0] && l2result.data.blocks[0]) {
        setL1BlockNumber(parseInt(l1result.data.blocks[0].number));
        setL2BlockNumber(parseInt(l2result.data.blocks[0].number));
      } else {
        alert("No block found at this date!");
      }
    })();
  }, [date, infuraKey]);

  useEffect(() => {
    (async () => {
      if (infuraKey.length) {
        const blockTag = (layer) => {
          if (layer == 1) {
            return l1blockNumber == 0 ? "latest" : l1blockNumber;
          } else if (layer == 2) {
            return l2blockNumber == 0 ? "latest" : l2blockNumber;
          }
        };

        const erc721Interface = new ethers.utils.Interface([
          "function name() view returns (string)",
          "function symbol() view returns (string)",
          "function totalSupply() view returns (uint256)",
          "function ownerOf(uint256) view returns (address)",
        ]);

        const l1Provider = new ethers.providers.JsonRpcProvider(
          `https://mainnet.infura.io/v3/${infuraKey}`
        );
        const l2Provider = new ethers.providers.JsonRpcProvider(
          `https://optimism-mainnet.infura.io/v3/${infuraKey}`
        );

        const nftAddresses = [
          SPARTAN_COUNCIL_NFT_ADDRESS,
          TREASURY_COUNCIL_NFT_ADDRESS,
          GRANTS_COUNCIL_NFT_ADDRESS,
          AMBASSADORS_COUNCIL_NFT_ADDRESS,
        ];

        let newPayouts = {};
        for (var i = 0; i < nftAddresses.length; i++) {
          const layer = 2;

          const nftContract = new ethers.Contract(
            nftAddresses[i],
            erc721Interface,
            layer == 1 ? l1Provider : l2Provider
          );

          // No 'totalSupply' function on the new tokens....
          // const tokenCount = await nftContract.totalSupply({
          //   blockTag: blockTag(layer),
          // });
          // Let's assume no more than 50?
          const tokenCount = 50;
          let newMemberAddresses = [];
          for (var j = 1; j <= tokenCount; j++) {
            try {
              const newAddress = ethers.utils.getAddress(
                await nftContract.ownerOf(j, { blockTag: blockTag(layer) })
              );
              if (newAddress == "0x0000000000000000000000000000000000000000") {
                break;
              }
              newMemberAddresses.push(newAddress);
            } catch {
              break;
            }
          }

          newPayouts[nftAddresses[i]] = {
            name: await nftContract.name({ blockTag: blockTag(layer) }),
            symbol: await nftContract.symbol({ blockTag: blockTag(layer) }),
            stipend: 2000,
            members: newMemberAddresses,
          };
        }
        setPayouts(newPayouts);
        setLoadingMembers(false);
      }
    })();
  }, [l1blockNumber, l2blockNumber, infuraKey]);

  const queueActions = async () => {
    setLoading(true);

    const erc20Interface = new ethers.utils.Interface([
      "function transfer(address recipient, uint256 amount)",
      "function balanceOf(address account) view returns (uint256)",
    ]);

    // Confirm the Gnosis Safe has a sufficient balance
    const totalPayout = Object.values(payouts).reduce((acc, v) => {
      return acc + v.members.length * v.stipend;
    }, 0);
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const snxContract = new ethers.Contract(
      L1_SNX_TOKEN_ADDRESS,
      erc20Interface,
      provider
    );
    const currentBalance = await snxContract.balanceOf(COUNCIL_SAFE_ADDRESS);
    const parsedBalance = parseInt(ethers.utils.formatEther(currentBalance));
    if (totalPayout > parsedBalance) {
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
    for (var i = 0; i < Object.values(payouts).length; i++) {
      for (var j = 0; j < Object.values(payouts)[i].members.length; j++) {
        const data = erc20Interface.encodeFunctionData("transfer", [
          Object.values(payouts)[i].members[j],
          ethers.utils.parseEther(Object.values(payouts)[i].stipend.toString()),
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
      checkPaymentStatus();
    }
  };

  return (
    <Box py={4}>
      {loadingMembers || !infuraKey.length ? (
        <Box textAlign="center">
          <Spinner my="6" />
          <Text fontSize="sm" mb="6" opacity="0.66">
            Make sure you've entered an Infura API Key
          </Text>
        </Box>
      ) : (
        Object.keys(payouts).map((nftAddress, i) => {
          return (
            <Council
              key={"council-" + i}
              nftAddress={nftAddress}
              name={payouts[nftAddress].name}
              symbol={payouts[nftAddress].symbol}
              stipend={payouts[nftAddress].stipend}
              members={payouts[nftAddress].members}
              layer={2}
            />
          );
        })
      )}
      <Button
        background="#00d1ff"
        width="100%"
        _hover={{ background: "#58e1ff" }}
        color="white"
        onClick={queueActions}
        mt={6}
        mb={12}
        size="lg"
        isLoading={loading}
        textTransform="uppercase"
        fontFamily="GT America"
        letterSpacing={1}
        fontWeight={400}
      >
        Queue Payouts
      </Button>
      <SimpleGrid columns="2" spacing="5">
        <FormControl mb={4}>
          <FormLabel htmlFor="date">
            Show holders of Council NFTs on...
          </FormLabel>
          <Input
            id="date"
            size="sm"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </FormControl>
        <FormControl mb={4}>
          <FormLabel htmlFor="infuraKey">Enter an Infura API Key</FormLabel>
          <Input
            id="infuraKey"
            size="sm"
            type="text"
            value={infuraKey}
            placeholder=""
            onChange={(event) => setInfuraKey(event.target.value)}
          />
          <FormHelperText>
            Enter the Infura ID for an archival node to fetch historical data.
          </FormHelperText>
        </FormControl>
      </SimpleGrid>
    </Box>
  );
};

export default CouncilMembers;
