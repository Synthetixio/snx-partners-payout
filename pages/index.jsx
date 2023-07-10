import { useEffect } from "react";
import Head from "next/head";

import {
  Container,
  Heading,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from "@chakra-ui/react";

import Network from "../components/Network";
import PerpsPartners from "../components/Partners/PerpsPartners";
import CouncilMembers from "../components/CouncilMembers";
import ManualEntry from "../components/ManualEntry";

import { ethers } from "ethers";

function refreshOnNetworkChange() {
  // The "any" network will allow spontaneous network changes
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  provider.on("network", (newNetwork, oldNetwork) => {
    // When a Provider makes its initial connection, it emits a "network"
    // event with a null oldNetwork along with the newNetwork. So, if the
    // oldNetwork exists, it represents a changing network
    if (oldNetwork) {
      window.location.reload();
    }
  });
}

const Home = () => {
  useEffect(() => {
    refreshOnNetworkChange();
  }, []);

  return (
    <div>
      <Head>
        <title>SNX Payout Tool</title>
      </Head>
      <Network />
      <Container>
        <Heading
          textTransform="uppercase"
          letterSpacing={3}
          fontFamily="GT America"
          fontWeight={700}
          as="h1"
          size="xl"
          mt={10}
          mb={6}
          textAlign="center"
        >
          SNX Payout Tool
        </Heading>

        <Tabs isFitted>
          <TabList>
            <Tab fontWeight={600}>Perps</Tab>
            <Tab fontWeight={600}>Council</Tab>
            <Tab fontWeight={600}>Manual</Tab>
          </TabList>

          <TabPanels>
            <TabPanel px={0}>
              <PerpsPartners />
            </TabPanel>
            <TabPanel px={0}>
              <CouncilMembers />
            </TabPanel>
            <TabPanel px={0}>
              <ManualEntry />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Container>
    </div>
  );
};

export default Home;
