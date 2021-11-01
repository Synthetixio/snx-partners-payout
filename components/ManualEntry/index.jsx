import { useState, useEffect } from "react";
import { Button, Box, Text, Code, Textarea, useToast } from "@chakra-ui/react";
import TransactionsTable from "./TransactionsTable";

import { ethers } from "ethers";
import SafeBatchSubmitter from "../../lib/SafeBatchSubmitter.js";
import {
  PARTNERS_SAFE_ADDRESS,
  SNX_TOKEN_ADDRESS,
  SUSD_TOKEN_ADDRESS,
} from "../../config.js";

async function generateSafeBatchSubmitter() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  let signer = provider.getSigner();
  signer.address = await signer.getAddress();
  let network = await provider.getNetwork();
  const safeBatchSubmitter = new SafeBatchSubmitter({
    network: network.name,
    signer,
    safeAddress: PARTNERS_SAFE_ADDRESS,
  });
  await safeBatchSubmitter.init();
  return safeBatchSubmitter;
}

const ManualEntry = () => {
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState("");
  const [transactions, setTransactions] = useState([]);
  const toast = useToast();

  const handleInputChange = (e) => {
    const inputValue = e.target.value;
    setEntry(inputValue);
  };

  useEffect(() => {
    const rows = entry.split("\n");
    let updatedTransactions = [];
    rows.forEach((r) => {
      const entries = r.split(",");
      if (entries[0]) {
        updatedTransactions.push({
          address: entries[0],
          snx: parseFloat(entries[1]) || 0,
          susd: parseFloat(entries[2]) || 0,
        });
      }
    });
    setTransactions(updatedTransactions);
  }, [entry]);

  const queueActions = async () => {
    setLoading(true);

    const erc20Interface = new ethers.utils.Interface([
      "function transfer(address recipient, uint256 amount)",
      "function balanceOf(address account) view returns (uint256)",
    ]);

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    // Confirm the Gnosis Safe has a sufficient SNX balance
    const totalSnx = transactions.reduce((acc, p) => {
      return acc + p.snx;
    }, 0);
    const snxContract = new ethers.Contract(
      SNX_TOKEN_ADDRESS,
      erc20Interface,
      provider
    );
    const currentSnxBalance = await snxContract.balanceOf(
      PARTNERS_SAFE_ADDRESS
    );
    const parsedSnxBalance = parseInt(
      ethers.utils.formatEther(currentSnxBalance)
    );
    if (totalSnx > parsedSnxBalance) {
      toast({
        title: "Insufficient Funds",
        description: `The safe doesn't have enough SNX tokens to complete this payout.`,
        status: "error",
        isClosable: true,
      });
      setLoading(false);
      return;
    }

    // Confirm the Gnosis Safe has a sufficient SUSD balance
    const totalSusd = transactions.reduce((acc, p) => {
      return acc + p.susd;
    }, 0);
    const susdContract = new ethers.Contract(
      SNX_TOKEN_ADDRESS,
      erc20Interface,
      provider
    );
    const currentSusdBalance = await susdContract.balanceOf(
      PARTNERS_SAFE_ADDRESS
    );
    const parsedSusdBalance = parseInt(
      ethers.utils.formatEther(currentSusdBalance)
    );
    if (totalSusd > parsedSusdBalance) {
      toast({
        title: "Insufficient Funds",
        description: `The safe doesn't have enough sUSD tokens to complete this payout.`,
        status: "error",
        isClosable: true,
      });
      setLoading(false);
      return;
    }

    // Queue transactions
    const safeBatchSubmitter = await generateSafeBatchSubmitter();

    for (let index = 0; index < transactions.length; index++) {
      const transaction = transactions[index];

      // Queue SNX transfers
      if (transaction.snx > 0) {
        const snxData = erc20Interface.encodeFunctionData("transfer", [
          ethers.utils.getAddress(transaction.address),
          ethers.utils.parseEther(transaction.snx.toString()),
        ]);
        await safeBatchSubmitter.appendTransaction({
          to: SNX_TOKEN_ADDRESS,
          data: snxData,
          force: false,
        });
      }

      // Queue sUSD transfers
      if (transaction.susd > 0) {
        const susdData = erc20Interface.encodeFunctionData("transfer", [
          ethers.utils.getAddress(transaction.address),
          ethers.utils.parseEther(transaction.susd.toString()),
        ]);
        await safeBatchSubmitter.appendTransaction({
          to: SUSD_TOKEN_ADDRESS,
          data: susdData,
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
    <Box py={4}>
      <Text mb={1}>
        Enter each payout you’d like to issue on a seperate line in the
        following format:
      </Text>
      <Code mb={6} fontSize="md">
        address,snxAmount,susdAmount
      </Code>
      <Textarea
        size="sm"
        value={entry}
        onChange={handleInputChange}
        placeholder={`0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B,100,0\n0x08Aeeb7E544A070a2553e142828fb30c214a1F86,200,1000`}
        mb={2}
      />
      {transactions.length ? (
        <>
          <TransactionsTable transactions={transactions} />
          <Button
            background="#00d1ff"
            width="100%"
            _hover={{ background: "#58e1ff" }}
            color="white"
            onClick={queueActions}
            my={6}
            size="lg"
            isLoading={loading}
            textTransform="uppercase"
            fontFamily="GT America"
            letterSpacing={1}
            fontWeight={400}
          >
            Queue Payouts
          </Button>
        </>
      ) : (
        ""
      )}
    </Box>
  );
};

export default ManualEntry;
