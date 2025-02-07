function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) => {
        const isTextNode =
          typeof child === 'string' || typeof child === 'number';
        return isTextNode ? createTextNode(child) : child;
      }),
    },
  };
}

/**
 * 处理文本节点
 * - 单独处理文本节点是因为文本节点是没有 type、children、props 的
 * - 需要给它加个固定的 type TEXT_ELEMENT，并且设置 nodeValue 的 props
 * - 这样结构统一，方便后面处理
 */
function createTextNode(nodeValue) {
  return {
    type: 'TEXT_ELEMENT',
    props: {
      nodeValue,
      children: [],
    },
  };
}

let nextUnitOfWork = null; // 指向下一个要处理的 fiber 节点
let wipRoot = null; // 当前正在处理的 fiber 链表的根 wipRoot
let currentRoot = null; // 之前的历史 fiber 链表的根 currentRoot

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  // 设置初始 nextUnitOfWork
  nextUnitOfWork = wipRoot;
}

function workLoop(deadline) {
  let shouldYield = false;
  // 每次跑的时候判断下 timeRemaining 是否接近 0，是的话就中断循环，等下次 requestIdleCallback 的回调再继续处理 nextUnitOfWork 指向的 fiber 节点
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  // 用 requestIdleCallback 来代替 React 的时间分片，把 React Element 树转 fiber 的 reconcile 过程放到不同的任务里跑
  requestIdleCallback(workLoop);
}

requestIdleCallback(workLoop);

function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  // 处理每个 fiber 节点的时候，要根据类型做不同的处理
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // 处理每个 fiber 节点之后，会按照 child、sibling、return 的顺序返回下一个要处理的 fiber 节点
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

let wipFiber = null; // 指向当前处理的 fiber
let stateHookIndex = null;

/**
 * 函数组件处理
 */
function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  stateHookIndex = 0;
  wipFiber.stateHooks = []; // 存储 useState 的 hook 的值
  wipFiber.effectHooks = []; // 存储 useEffect 的 hook 的值

  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

/**
 * 原生标签处理
 */
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

const MiniReact = {
  createElement,
};

window.MiniReact = MiniReact;
