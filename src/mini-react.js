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

const MiniReact = {
  createElement,
};

window.MiniReact = MiniReact;
