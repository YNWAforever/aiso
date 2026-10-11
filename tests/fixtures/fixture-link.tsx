import React from 'react'
export default function FixtureLink({href,children,...props}:{href:string;children:React.ReactNode;className?:string}){return <a href={href} {...props}>{children}</a>}
