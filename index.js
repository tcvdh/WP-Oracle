const { ethers } = require("ethers");
const axios = require('axios').default;
require('dotenv').config();

// var express = require('express')
// var app = express()
// var port = process.env.PORT || 5000
// app.get('/',function(req,res){
//     res.send('Listening for events...')
// })
// app.listen(port)

const { POLYABI } = require('./ABI/polyabi');
const { ETHABI } = require('./ABI/ethabi');
const { Claimabi } = require('./ABI/Claimabi');

const privateKey = process.env.PRIVATE_KEY;

// const ETHprovider = new ethers.providers.StaticJsonRpcProvider("https://mainnet.infura.io/v3/a0ecf0217614452099724b8999730684");
// const POLYprovider = new ethers.providers.StaticJsonRpcProvider("https://polygon-mainnet.infura.io/v3/a0ecf0217614452099724b8999730684");

const ETHprovider = new ethers.providers.WebSocketProvider("wss://eth-mainnet.alchemyapi.io/v2/LNQf8Y4wDbAspLYGTu6fFQN2QVB3-v8Z");
const POLYprovider = new ethers.providers.WebSocketProvider("wss://polygon-mainnet.g.alchemy.com/v2/gc-aX2SBlByVETru1dR9Z1PzMBn5YtQQ");

let POLYwalletSigner = new ethers.Wallet(privateKey, POLYprovider);
let ETHwalletSigner = new ethers.Wallet(privateKey, ETHprovider);

const POLYcontractAddress = "0x34570e0Cb7EA8e1609B3B703D7Df7026d83a1Fdf";
const ETHcontractAddress = "0x29c7aC3C0b9AaCa1d53f75720ba2821C65FE77Fa";
const claimAddress = "0x2Fd50c24C7170B303b4d7c1fC00d985bf844111b";
const POLYcontract = new ethers.Contract(POLYcontractAddress, POLYABI, POLYwalletSigner);
const ETHcontract = new ethers.Contract(ETHcontractAddress, ETHABI, ETHwalletSigner);
const claimContract = new ethers.Contract(claimAddress, Claimabi, POLYwalletSigner);


// eth nonce
let ETHbaseNonce = ETHprovider.getTransactionCount("0x95Cce6F5E3AdE23044dD91B7F28BfD8C733612b5");
let ETHnonceOffset = 0;
function getEthNonce() {
  return ETHbaseNonce.then((nonce) => (nonce + (ETHnonceOffset++)));
}

// poly nonce
// let POLYbaseNonce = POLYprovider.getTransactionCount("0x95Cce6F5E3AdE23044dD91B7F28BfD8C733612b5");
// let POLYnonceOffset = 0;
// function getPolyNonce() {
//   return POLYbaseNonce.then((nonce) => (nonce + (POLYnonceOffset++)));
// }


async function listen() {
    const startBlockNumberPoly = await POLYprovider.getBlockNumber();
    const startBlockNumberEth = await ETHprovider.getBlockNumber();

    // polygon bridge start
    POLYcontract.on("startBatchBridge", (user, IDs, ...args) => {
        const event = args[args.length - 1];
        if(event.blockNumber > startBlockNumberPoly) {
            startFromPoly(user, IDs);
        }
    });

    // rinkeby bridge start
    ETHcontract.on("startBatchBridge", (user, IDs, bridgeMigrateTimestamps, ...args) => {
        const event = args[args.length - 1];
        if(event.blockNumber > startBlockNumberEth) {
            startFromEth(user, IDs, bridgeMigrateTimestamps);
        }
    });
    
    claimContract.on("checkEthTokens", async (wallet, ...args) => {
        // const wallet = args[0];
        const event = args[args.length - 1];
        if(event.blockNumber > startBlockNumberPoly) {
            // console.log(wallet)
            try {
                claimEth(wallet);
              } catch (error) {
                console.error(error);
              }
        }
    })
}  


async function startFromPoly(user, IDs) {

    const gas = await ETHcontract.estimateGas.depositBridge(user, IDs);
    const gasPrice = await ETHprovider.getGasPrice();
    const gasFormat = ethers.utils.formatUnits(gas, "wei");
    const gasPriceFormat = parseInt(ethers.utils.formatUnits(gasPrice, "wei") * 1.10);
    // console.log(ethers.utils.formatUnits(gasFormat, "wei"), gasPriceFormat);
    
    // console.log("estimated eth gas cost: " + ethers.utils.formatEther(gasFormat * gasPriceFormat));


    var overrideOptions = {
        gasLimit: gasFormat,
        gasPrice: gasPriceFormat,
        nonce: getEthNonce()
    }

    let write = await ETHcontract.depositBridge(user, IDs, overrideOptions)
    write.wait()
        .then(async (transaction) => {
            console.log("tx hash (poly -> eth): " + transaction.transactionHash);
        })
}

async function startFromEth(user, IDs, bridgeMigrateTimestamps) {
    const gasPrice = await provider.getGasPrice();
    const gasPriceFormat = parseInt(ethers.utils.formatUnits(gasPrice, "wei") * 1.50);

    var overrideOptions = {
        gasPrice: gasPriceFormat,
        nonce: POLYwalletSigner.getTransactionCount()
    }

    let write = await contract.depositBridge(user, IDs, bridgeMigrateTimestamps, overrideOptions)
    write.wait()
        .then(async (transaction) => {
            console.log("tx hash (eth -> poly): " + transaction.transactionHash);
        })
}



async function claimEth(wallet) {
    const url = `https://api.nftport.xyz/v0/accounts/${wallet}`
    const res = await axios.get(url, {
        params: {
        chain: 'ethereum',
        contract_address: '0x29c7aC3C0b9AaCa1d53f75720ba2821C65FE77Fa'
        },
        headers: {
        'Content-Type': 'application/json',
        Authorization: 'c8fa1814-aa4a-481c-b381-b930274c18d9'
        }
    })

    var IDs = []
    if (res.data.response === 'OK' && res.data.nfts.length > 0) {
    //   console.log(res.data)
        const ids = res.data.nfts.map((i) =>
        parseInt(i.token_id)
        )
        IDs = ids.sort((a, b) => a - b);
    }
    // console.log(IDs)
    if(IDs.length > 0 ) {
        const mintTimestamps = await ETHcontract.getMigrateTimestamps(IDs);

        const gasPrice = await POLYprovider.getGasPrice();
        const gasPriceFormat = parseInt(ethers.utils.formatUnits(gasPrice, "wei") * 1.50);

        const gas = await claimContract.estimateGas.oracleClaimEthTokens(wallet, IDs, mintTimestamps)
        const gasFormat = ethers.utils.formatUnits(gas, 'wei')

        var overrideOptions = {
            gasLimit: gasFormat,
            gasPrice: gasPriceFormat,
            nonce: POLYwalletSigner.getTransactionCount()
        };

        // claimContract.oracleClaimEthTokens(wallet, IDs)
        let write = await claimContract.oracleClaimEthTokens(wallet, IDs, mintTimestamps, overrideOptions)
        write.wait()
        //     .then(async (transaction) => {
        //         console.log("tx hash (claim): " + transaction.transactionHash);
        //     })
    }
}
listen();