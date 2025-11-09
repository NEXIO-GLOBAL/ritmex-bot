import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { tradingConfig } from "../config";
import { resolveExchangeId, getExchangeDisplayName } from "../exchanges/create-adapter";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { GuardianEngine, type GuardianEngineSnapshot } from "../strategy/guardian-engine";
import { formatNumber } from "../utils/format";
import { DataTable, type TableColumn } from "./components/DataTable";

interface GuardianAppProps {
  onExit: () => void;
}

const READY_MESSAGE = "正在等待行情/账户推送…";
const inputSupported = Boolean(process.stdin && (process.stdin as any).isTTY);

export function GuardianApp({ onExit }: GuardianAppProps) {
  const [snapshot, setSnapshot] = useState<GuardianEngineSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const engineRef = useRef<GuardianEngine | null>(null);
  const exchangeId = useMemo(() => resolveExchangeId(), []);
  const exchangeName = useMemo(() => getExchangeDisplayName(exchangeId), [exchangeId]);

  useInput(
    (input, key) => {
      if (key.escape) {
        engineRef.current?.stop();
        onExit();
      }
    },
    { isActive: inputSupported }
  );

  useEffect(() => {
    try {
      const adapter = buildAdapterFromEnv({ exchangeId, symbol: tradingConfig.symbol });
      const engine = new GuardianEngine(tradingConfig, adapter);
      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      const handler = (next: GuardianEngineSnapshot) => {
        setSnapshot({ ...next, tradeLog: [...next.tradeLog] });
      };
      engine.on("update", handler);
      engine.start();
      return () => {
        engine.off("update", handler);
        engine.stop();
      };
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [exchangeId]);

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Guardian 策略启动失败: {error.message}</Text>
        <Text color="gray">请检查环境变量和网络连通性。</Text>
      </Box>
    );
  }

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text>正在初始化 Guardian 策略…</Text>
      </Box>
    );
  }

  const { position, stopOrder, trailingOrder, tradeLog, ready, guardStatus } = snapshot;
  const hasPosition = Math.abs(position.positionAmt) > 1e-8;
  const stopOrderPrice = stopOrder ? Number(stopOrder.stopPrice ?? stopOrder.price) : null;
  const trailingActivate = trailingOrder ? Number(trailingOrder.activatePrice ?? (trailingOrder as any).activationPrice) : null;
  const lastLogs = tradeLog.slice(-6);
  const orderColumns: TableColumn[] = [
    { key: "id", header: "ID", align: "right", minWidth: 6 },
    { key: "side", header: "Side", minWidth: 4 },
    { key: "type", header: "Type", minWidth: 12 },
    { key: "price", header: "Price", align: "right", minWidth: 10 },
    { key: "qty", header: "Qty", align: "right", minWidth: 8 },
    { key: "status", header: "Status", minWidth: 10 },
  ];
  const orderRows = [...snapshot.openOrders]
    .sort((a, b) => (Number(b.updateTime ?? 0) - Number(a.updateTime ?? 0)) || Number(b.orderId) - Number(a.orderId))
    .slice(0, 8)
    .map((order) => ({
      id: order.orderId,
      side: order.side,
      type: order.type,
      price: order.price ?? order.stopPrice,
      qty: order.origQty,
      status: order.status,
    }));

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyanBright">Guardian Strategy Dashboard</Text>
        <Text>
          交易所: {exchangeName} ｜ 交易对: {snapshot.symbol} ｜ 最近价格: {formatNumber(snapshot.lastPrice, 2)} ｜ 状态: {ready ? "实时运行" : READY_MESSAGE}
        </Text>
        <Text color="gray">策略只会维护止损/止盈，不会主动开仓。按 Esc 返回菜单。</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="greenBright">当前仓位与风控</Text>
        {hasPosition ? (
          <>
            <Text>
              方向: {position.positionAmt > 0 ? "多" : "空"} ｜ 数量: {formatNumber(Math.abs(position.positionAmt), 4)} ｜ 开仓价: {formatNumber(position.entryPrice, 2)} ｜ 浮动盈亏: {formatNumber(snapshot.pnl, 4)} USDT
            </Text>
            <Text>
              目标止损价: {formatNumber(snapshot.targetStopPrice, 2)} ｜ 当前止损单: {formatNumber(stopOrderPrice, 2)} ｜ 动态止盈触发: {formatNumber(snapshot.trailingActivationPrice, 2)} ｜ 动态止盈单: {formatNumber(trailingActivate, 2)}
            </Text>
            <Text color={snapshot.requiresStop ? "yellow" : "gray"}>
              Guardian 状态: {guardStatus === "protecting" ? "已挂止损" : guardStatus === "pending" ? "缺少止损，正在同步" : "监听中"}
            </Text>
          </>
        ) : (
          <Text color="gray">当前无持仓，Guardian 正在监听新的仓位变化。</Text>
        )}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">当前挂单</Text>
        {orderRows.length > 0 ? (
          <DataTable columns={orderColumns} rows={orderRows} />
        ) : (
          <Text color="gray">暂无保护类挂单</Text>
        )}
      </Box>

      <Box flexDirection="column">
        <Text color="yellow">最近事件</Text>
        {lastLogs.length > 0 ? (
          lastLogs.map((item, index) => (
            <Text key={`${item.time}-${index}`}>
              [{item.time}] [{item.type}] {item.detail}
            </Text>
          ))
        ) : (
          <Text color="gray">暂无日志</Text>
        )}
      </Box>
    </Box>
  );
}
