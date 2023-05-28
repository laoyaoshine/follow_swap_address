const WebSocket = require("ws");
const BlocknativeSdk = require("bnc-sdk");
const Web3 = require("web3");
const config = require("./f_config.json");
const bep20 = require("./bep20.json");
const web3 = new Web3(config.rpc);
const uniswapV2RouterAbi = require("./swap_abi");
const UniswapContractRouter = new web3.eth.Contract(
  uniswapV2RouterAbi,
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d"
);
let lastTxTime = 0;
const options = {
  dappId: config.apikey,
  ws: WebSocket,
  networkId: 1,
  onerror: (error) => {
    console.log(error.message);
  },
  onopen: () => console.log("WSS链接成功"),
};

const blocknative = new BlocknativeSdk(options);
const { emitter } = blocknative.account(config.followAddress);

emitter.on("txPool", async (transaction) => {
  const txTime = transaction.timestamp;
  if (txTime > lastTxTime) {
    lastTxTime = txTime;
  console.log(`监控到[${config.followAddress}]发出交易`);

  const { maxFeePerGas, maxPriorityFeePerGas, gasPrice, value } = transaction;
  const methods = transaction?.contractCall?.methodName;
  console.log(methods);
  if (methods == "swapExactETHForTokens") {
    const contract = transaction?.contractCall?.params?.path[1];
    const sendValue = web3.utils.fromWei(value, "ether");
    const mySendValue = formatRoundNum(sendValue * 1 * config["Purchase proportion"],'6');

    const gasPriceDefault = web3.utils.toWei('2', 'gwei'); // 你需要自定义这个默认值
    const maxFeePerGasDefault = web3.utils.toWei('2', 'gwei'); // 你需要自定义这个默认值

    // 调用自动调整滑点函数
    const { minReceivedAmount, slippage } = await autoAdjustSlippage(mySendValue, contract);

    let amounout = await limit(web3.utils.toWei(mySendValue.toString(),'ether'), contract);
    let nonce = await web3.eth.getTransactionCount(config.myaddress, "pending");
    send(
      gasPrice ? gasPrice : gasPriceDefault,
      maxFeePerGas ? maxFeePerGas : maxFeePerGasDefault,
      maxPriorityFeePerGas ? maxPriorityFeePerGas : maxPriorityFeePerGas,
      contract,
      methods,
      amounout,
      web3.utils.toWei(mySendValue.toString(),'ether'),
      nonce,
      slippage
    );
  }
}
});

async function limit(sendValue, contract) {
    try {
      const bep202 = new web3.eth.Contract(bep20, contract);
      var dec = await bep202.methods.decimals().call();
      const res = await UniswapContractRouter.methods.getAmountsOut(sendValue, [config.WETH, contract]).call();
      const amountOut = res[1];
      console.log(`计算交换输出量: ${web3.utils.fromWei(amountOut, "ether")} ${contract}`);
      return outLanceWei(amountOut, dec);
    } catch (e) {
      console.error(`计算交换输出量发生错误: ${e.message}`);
      throw e;
    }
  }
  async function autoAdjustSlippage(sendValue, contract) {
    try {
      const bep202 = new web3.eth.Contract(bep20, contract);
      var dec = await bep202.methods.decimals().call();
      const res = await UniswapContractRouter.methods.getAmountsOut(sendValue, [config.WETH, contract]).call();
      const amountOut = res[1];
      const amountIn = web3.utils.toWei(sendValue, "ether");
      const marketPrice = amountOut / amountIn;
      console.log(`市场价格: ${marketPrice} ${contract}`);
      const slippage = config.Slippage;
      console.log(`初始滑点: ${slippage}%`);
      const minReceivedAmount = calculateMinReceivedAmount(amountIn, amountOut, slippage);
      console.log(`最小收到金额: ${web3.utils.fromWei(minReceivedAmount, "以太")} ${contract}`);
  
      if (marketPrice < config.ExpectedPrice) {
        console.log("市场价格低于期望价格，增加滑点");
        let newSlippage = slippage + config.SlippageIncrement;
        if (newSlippage > config.MaxSlippage) {
          newSlippage = config.MaxSlippage;
        }
        console.log(`新的滑点: ${newSlippage}%`);
        const newMinReceivedAmount = calculateMinReceivedAmount(amountIn, amountOut, newSlippage);
        console.log(`新的最小收到金额: ${web3.utils.fromWei(newMinReceivedAmount, "ether")} ${contract}`);
        return { minReceivedAmount: newMinReceivedAmount, slippage: newSlippage };
      }
  
      if (marketPrice > config.ExpectedPrice) {
        console.log("市场价格高于期望价格，减小滑点");
        let newSlippage = slippage - config.SlippageDecrement;
        if (newSlippage < config.MinSlippage) {
          newSlippage = config.MinSlippage;
        }
        console.log(`新的滑点: ${newSlippage}%`);
        const newMinReceivedAmount = calculateMinReceivedAmount(amountIn, amountOut, newSlippage);
        console.log(`新的最小收到金额: ${web3.utils.fromWei(newMinReceivedAmount, "ether")} ${contract}`);
        return { minReceivedAmount: newMinReceivedAmount, slippage: newSlippage };
      }
  
      // 如果市场价格符合期望价格，则使用初始滑点
      console.log("市场价格符合期望价格，使用初始滑点");
      return { minReceivedAmount, slippage };
    } catch (e) {
      console.error(`自动调整滑点发生错误: ${e.message}`);
      throw e;
    }
  }
  
  function calculateMinReceivedAmount(amountIn, amountOut, slippage) {
    const minReceivedAmount = amountOut * (1 - slippage / 100);
    return minReceivedAmount.toFixed(0);
  }
  
  function formatRoundNum(num, decimalPlace) {
    return Number.parseFloat(num).toFixed(decimalPlace);
  }
  
  
