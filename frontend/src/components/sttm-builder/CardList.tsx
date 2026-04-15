'use client';

import {CardItem} from './CardItem';

export default function CardList({ items = [] }) {
  return (
    <>
      {items.map((item, index) => (
        <CardItem
          
        />
      ))}
    </>
  );
}
