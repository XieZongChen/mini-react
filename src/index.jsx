const { render, useState, useEffect } = window.MiniReact;

function App() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount((count) => count + 1);
  }

  return <button onClick={handleClick}>点击次数：{count}</button>;
}

render(<App />, document.getElementById('root'));
