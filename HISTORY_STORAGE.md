# 历史报告存储逻辑说明

## 存储位置

历史报告存储在**浏览器的 localStorage** 中，具体位置：

- **存储键名**：`intelligentStockAgentHistory`
- **存储格式**：JSON 字符串
- **存储位置**：浏览器本地存储（每个域名独立）

### localStorage 的特点

1. **持久性**：
   - ✅ **重启服务器不影响**：localStorage 存储在浏览器中，与服务器无关
   - ✅ **关闭浏览器后仍然存在**：除非用户手动清除浏览器数据
   - ✅ **跨会话持久**：刷新页面、关闭标签页都不会丢失数据

2. **作用域**：
   - 每个域名（domain）有独立的 localStorage
   - 不同端口视为同一域名（如 `localhost:3000` 和 `localhost:3001` 共享）
   - 不同协议（http/https）视为不同域名

3. **限制**：
   - 存储大小限制：通常 5-10MB（取决于浏览器）
   - 只能存储字符串（JSON 需要序列化）
   - 同源策略：只能在同一域名下访问

## 存储逻辑

### 1. 历史记录保存

**触发时机**：当分析完成时（`status === 'complete'`）

**保存位置**：`localStorage.getItem('intelligentStockAgentHistory')`

**保存内容**：完整的 `AnalysisState` 对象，包括：
- `id`: 时间戳生成的唯一 ID
- `timestamp`: ISO 格式的时间戳
- `query`: 用户查询内容
- `status`: 分析状态
- `focusCompany`: 核心公司分析数据
- `candidateCompanies`: 候选公司分析数据
- 其他分析结果数据

### 2. 活跃状态保存

**存储键名**：`intelligentStockAgentActiveState`

**保存时机**：
- 当 `analysisState.status !== 'idle'` 时保存
- 当状态变为 `'idle'` 时删除

**用途**：保存当前正在进行的分析或已完成的当前分析

### 3. 数据加载

**初始化时**：
1. 从 `localStorage` 加载历史记录
2. 自动去重（基于 `id`）
3. 从 `localStorage` 加载活跃状态（如果存在）

## 已修复的问题

### 问题 1：重复显示历史报告

**原因**：
- 在 `setAnalysisState` 的回调中调用 `setHistory`，导致状态更新不同步
- React 的批量更新可能导致重复添加
- 没有去重检查

**修复**：
1. ✅ 分离状态更新逻辑，先更新 history，再更新 analysisState
2. ✅ 添加去重检查：检查历史记录中是否已存在相同 `id` 的记录
3. ✅ 如果已存在，更新记录而不是添加新记录
4. ✅ 在加载时自动去重

### 问题 2：删除一份报告，另一份也消失

**原因**：
- 历史记录中存在重复条目（相同的 `id`）
- 删除时使用 `filter(item => item.id !== id)`，会删除所有匹配的记录

**修复**：
1. ✅ 添加去重逻辑，确保每个 `id` 只出现一次
2. ✅ 删除时明确过滤掉匹配的记录
3. ✅ 如果删除的是当前活跃状态，同时重置活跃状态

## 代码修改详情

### 1. 历史记录添加逻辑（第387-401行）

**修改前**：
```typescript
setAnalysisState(prevState => {
    const finalState = { ...prevState, status: 'complete', ... };
    setHistory(prevHistory => [finalState, ...prevHistory]);
    return finalState;
});
```

**修改后**：
```typescript
const finalState: AnalysisState = { ...analysisState, status: 'complete', ... };

// 添加去重检查
setHistory(prevHistory => {
    const exists = prevHistory.some(item => item.id === finalState.id);
    if (exists) {
        // 更新而不是添加
        return prevHistory.map(item => 
            item.id === finalState.id ? finalState : item
        );
    }
    return [finalState, ...prevHistory];
});

setAnalysisState(finalState);
```

### 2. 删除逻辑（第411-423行）

**修改前**：
```typescript
const deleteFromHistory = useCallback((id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
}, []);
```

**修改后**：
```typescript
const deleteFromHistory = useCallback((id: string) => {
    setHistory(prev => {
        const filtered = prev.filter(item => item.id !== id);
        // 如果删除的是当前活跃状态，重置活跃状态
        setAnalysisState(current => {
            if (current.id === id && current.status === 'complete') {
                return createInitialState();
            }
            return current;
        });
        return filtered;
    });
}, []);
```

### 3. 加载时去重（第50-58行）

**修改后**：
```typescript
const [history, setHistory] = useState<AnalysisState[]>(() => {
    try {
        const savedHistoryJSON = localStorage.getItem(HISTORY_KEY);
        if (savedHistoryJSON) {
            const parsed = JSON.parse(savedHistoryJSON);
            // 加载时自动去重
            const uniqueHistory = Array.from(
                new Map(parsed.map((item: AnalysisState) => [item.id, item])).values()
            );
            return uniqueHistory;
        }
        return [];
    } catch (error) {
        console.error('Could not load history from local storage', error);
        return [];
    }
});
```

### 4. 保存时去重（第72-88行）

**修改后**：
```typescript
useEffect(() => {
    try {
        // 保存前去重
        const uniqueHistory = Array.from(
            new Map(history.map(item => [item.id, item])).values()
        );
        localStorage.setItem(HISTORY_KEY, JSON.stringify(uniqueHistory));
        
        if (uniqueHistory.length !== history.length) {
            console.warn(`Found duplicate entries. They will be removed on next load.`);
        }
    } catch (error) {
        console.error('Could not save history to local storage', error);
    }
}, [history]);
```

## 数据持久性

### 重启服务器

✅ **历史报告会保留**

原因：
- localStorage 存储在浏览器中，与服务器无关
- 服务器重启不影响浏览器本地存储
- 只要浏览器数据未被清除，历史记录就会保留

### 清除数据的方法

1. **清除浏览器数据**：
   - Chrome: 设置 → 隐私和安全 → 清除浏览数据 → 选择"本地存储的数据"
   - 或使用开发者工具：Application → Storage → Local Storage → 右键删除

2. **代码清除**：
   - 点击"清空历史记录"按钮
   - 或手动执行：`localStorage.removeItem('intelligentStockAgentHistory')`

3. **清除单个报告**：
   - 在历史记录侧边栏中点击删除按钮

## 数据迁移

如果需要迁移历史数据：

1. **导出数据**：
```javascript
// 在浏览器控制台执行
const history = JSON.parse(localStorage.getItem('intelligentStockAgentHistory'));
console.log(JSON.stringify(history, null, 2));
```

2. **导入数据**：
```javascript
// 在浏览器控制台执行
const historyData = [...]; // 你的历史数据
localStorage.setItem('intelligentStockAgentHistory', JSON.stringify(historyData));
```

## 注意事项

1. **存储限制**：
   - 如果历史记录过多，可能达到 localStorage 大小限制
   - 建议定期清理旧记录或实现分页加载

2. **跨设备同步**：
   - localStorage 不会跨设备同步
   - 如果需要跨设备同步，需要实现服务器端存储

3. **隐私**：
   - 历史记录存储在用户浏览器中
   - 不会发送到服务器（除非实现同步功能）

4. **浏览器兼容性**：
   - 现代浏览器都支持 localStorage
   - IE8+ 支持

## 测试验证

### 测试去重功能

1. 完成一次分析
2. 刷新页面
3. 检查历史记录中是否只有一份报告

### 测试删除功能

1. 完成一次分析
2. 在历史记录中删除该报告
3. 确认报告被删除且不会影响其他报告

### 测试持久性

1. 完成一次分析
2. 关闭浏览器
3. 重新打开浏览器
4. 确认历史记录仍然存在
