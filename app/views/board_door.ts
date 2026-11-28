import { html } from 'lit';

/* The front page's one affiliate box, at its foot (owner, 2026-11-28): the Summa set the
   Aquinas shelf carries, in the Library's affiliate style (styles/support.css). The rooms and
   threads carry none. Its link is content/affiliate.json's "places".community book, which
   tests/py/test_inject_support.py holds this template to. */
export const summaTpl = html`<aside class="mc-support" aria-label="Help support the Mere Catholicity Project">
<link rel="stylesheet" href="support.css">
<p class="mc-support-heart" aria-hidden="true">&hearts;</p>
<p class="mc-support-head">With our thanks</p>
<p>Would you like St. Thomas Aquinas&rsquo;s <em>Summa Theologica</em> in print? The English Dominican translation, the one our Library reads online, comes as a five-volume hardcover set. The link below is an Amazon affiliate link: when you buy through it, Amazon pays a small commission, <strong>at no extra cost to you, and it helps support the Mere Catholicity Project.</strong> We are grateful for every one.</p>
<p class="mc-support-go"><a href="https://www.amazon.com/dp/0870610635?linkCode=ll2&tag=lerinspress-20&linkId=d6f69fb52e1f737aef389e1afe9b1cea&language=en_US&ref_=as_li_ss_tl" rel="sponsored noopener">Buy the Summa on Amazon (Hardcover, 5 volumes)</a></p>
<p class="mc-support-note">Affiliate link. As an Amazon Associate we earn from qualifying purchases.</p>
</aside>`;
