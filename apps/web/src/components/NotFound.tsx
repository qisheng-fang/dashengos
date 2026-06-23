import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0a0a0f',color:'#fff',gap:16}}>
      <div style={{fontSize:72}}>404</div>
      <div style={{fontSize:18,color:'#888'}}>页面未找到</div>
      <Link to="/" style={{color:'#0df0ff',textDecoration:'none',fontSize:14}}>← 返回工作台</Link>
    </div>
  )
}
